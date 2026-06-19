#!/usr/bin/env node

import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const modelConfig = readJson(path.join(root, "config", "local-models.json"));
const command = args._[0] || "setup";
const bucket = args.bucket || process.env.R2_MODEL_BUCKET || "ecc-local-models";
const prefix = normalizePrefix(args.prefix ?? process.env.R2_MODEL_PREFIX ?? "ecc");
const domain = args.domain || process.env.R2_MODEL_DOMAIN || "";
let mirrorUrl =
  args.mirrorUrl ||
  process.env.OLLAMA_MODEL_MIRROR_BASE_URL ||
  (domain ? joinUrl(`https://${domain}`, prefix) : "");
const artifactDir = path.resolve(
  root,
  args.artifactDir ||
    process.env.OLLAMA_MODEL_ARTIFACT_DIR ||
    path.join(".cache", "ollama-models"),
);
const location = args.location || process.env.R2_MODEL_LOCATION || "";
const jurisdiction = args.jurisdiction || process.env.R2_MODEL_JURISDICTION || "";
const envPath = path.resolve(root, args.envPath || ".env.local");
const maxWranglerUploadBytes = 290 * 1024 * 1024;
const chunkSizeBytes = parsePositiveInteger(
  args.chunkMb || process.env.R2_MODEL_CHUNK_MB,
  256,
) * 1024 * 1024;

main().catch((error) => {
  console.error(`\nR2 model mirror setup failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help || args.h) {
    printHelp();
    return;
  }

  if (!["setup", "upload", "env", "urls"].includes(command)) {
    throw new Error(`Unknown command "${command}". Use --help for options.`);
  }

  const artifacts = getConfiguredArtifacts();

  if (command === "urls") {
    printMirrorUrls(artifacts);
    return;
  }

  if (command === "env") {
    requireMirrorUrl();
    writeEnvValue("OLLAMA_MODEL_MIRROR_BASE_URL", mirrorUrl);
    console.log(`Saved OLLAMA_MODEL_MIRROR_BASE_URL=${mirrorUrl} to ${envPath}`);
    if (!args.noWriteConfig) {
      writeModelConfigMirrorUrl(mirrorUrl);
      console.log("Saved mirrorBaseUrl to config/local-models.json for future clones.");
    }
    return;
  }

  ensureWranglerAvailable();

  if (command === "setup") {
    createBucket();
    if (domain) {
      addCustomDomain();
    } else if (args.devUrl) {
      const devUrl = enableDevUrl();
      if (!mirrorUrl && devUrl) {
        mirrorUrl = joinUrl(devUrl, prefix);
      }
    } else {
      console.log(
        "No --domain was provided, so the bucket was created without public production access.",
      );
      console.log(
        "Use --domain models.example.com, or --dev-url for Cloudflare's non-production r2.dev URL.",
      );
    }
  }

  await uploadArtifacts(artifacts);

  if (mirrorUrl) {
    writeEnvValue("OLLAMA_MODEL_MIRROR_BASE_URL", mirrorUrl);
    console.log(`Saved OLLAMA_MODEL_MIRROR_BASE_URL=${mirrorUrl} to ${envPath}`);
    if (!args.noWriteConfig) {
      writeModelConfigMirrorUrl(mirrorUrl);
      console.log("Saved mirrorBaseUrl to config/local-models.json for future clones.");
    }
  } else {
    console.log(
      "Set OLLAMA_MODEL_MIRROR_BASE_URL after your R2 bucket has a public URL.",
    );
  }

  printMirrorUrls(artifacts);
}

function createBucket() {
  const wranglerArgs = ["r2", "bucket", "create", bucket];
  if (location) {
    wranglerArgs.push(`--location=${location}`);
  }
  if (jurisdiction) {
    wranglerArgs.push(`--jurisdiction=${jurisdiction}`);
  }

  const result = runWrangler(wranglerArgs, { allowFailure: true });
  if (result.status === 0) {
    return;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (/already exists|bucket.+exists|binding.+already/i.test(output)) {
    console.log(`R2 bucket ${bucket} already exists.`);
    return;
  }

  throw new Error(`Could not create R2 bucket ${bucket}.\n${output.trim()}`);
}

function addCustomDomain() {
  const result = runWrangler(
    ["r2", "bucket", "domain", "add", bucket, `--domain=${domain}`],
    { allowFailure: true },
  );
  if (result.status === 0) {
    return;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (/already|exists|connected/i.test(output)) {
    console.log(`Custom domain ${domain} already appears to be connected.`);
    return;
  }

  throw new Error(
    `Could not connect custom domain ${domain} to R2 bucket ${bucket}.\n${output.trim()}`,
  );
}

function enableDevUrl() {
  runWrangler(["r2", "bucket", "dev-url", "enable", bucket]);
  const result = runWrangler(["r2", "bucket", "dev-url", "get", bucket], {
    allowFailure: true,
  });
  if (result.status === 0) {
    const output = result.stdout.trim();
    console.log(output);
    const match = output.match(/https:\/\/\S*?r2\.dev\b/);
    return match?.[0] ?? "";
  }
  return "";
}

async function uploadArtifacts(artifacts) {
  if (artifacts.length === 0) {
    console.log("No model artifacts are configured in config/local-models.json.");
    return;
  }

  let uploadedCount = 0;
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact.localPath)) {
      console.warn(`Missing ${artifact.model} artifact: ${artifact.localPath}`);
      continue;
    }

    const sha256 = await sha256File(artifact.localPath);
    if (artifact.sha256 && artifact.sha256 !== sha256) {
      throw new Error(
        `${artifact.localPath} hash mismatch. Expected ${artifact.sha256}, got ${sha256}.`,
      );
    }

    const fileSize = fs.statSync(artifact.localPath).size;
    if (fileSize > maxWranglerUploadBytes) {
      await uploadChunkedArtifact(artifact, sha256, fileSize);
    } else {
      await uploadObject({
        key: artifact.objectKey,
        filePath: artifact.localPath,
        contentType: "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      });
    }
    uploadedCount += 1;
  }

  console.log(`Uploaded ${uploadedCount} model artifact(s).`);
}

async function uploadChunkedArtifact(artifact, sha256, fileSize) {
  const partDir = path.join(
    artifactDir,
    ".r2-parts",
    artifact.fileName.replace(/[^A-Za-z0-9._-]+/g, "-"),
  );
  fs.rmSync(partDir, { recursive: true, force: true });
  fs.mkdirSync(partDir, { recursive: true });

  const parts = await createPartFiles(artifact.localPath, partDir, chunkSizeBytes);
  const manifestParts = [];

  for (const part of parts) {
    const key = joinKey(`${artifact.objectKey}.parts`, part.name);
    await uploadObject({
      key,
      filePath: part.path,
      contentType: "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    });
    manifestParts.push({
      path: `${path.basename(artifact.objectKey)}.parts/${part.name}`,
      size: part.size,
      sha256: part.sha256,
    });
  }

  const manifestPath = path.join(partDir, `${artifact.fileName}.manifest.json`);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        fileName: artifact.fileName,
        size: fileSize,
        sha256,
        parts: manifestParts,
      },
      null,
      2,
    )}\n`,
  );
  await uploadObject({
    key: `${artifact.objectKey}.manifest.json`,
    filePath: manifestPath,
    contentType: "application/json",
    cacheControl: "public, max-age=31536000, immutable",
  });
}

async function createPartFiles(sourcePath, partDir, maxPartSize) {
  const parts = [];
  const source = await fs.promises.open(sourcePath, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let partIndex = 0;
  let currentPart = createPartWriter(partDir, partIndex);

  try {
    while (true) {
      const read = await source.read(buffer, 0, buffer.length, null);
      if (read.bytesRead === 0) {
        break;
      }

      let offset = 0;
      while (offset < read.bytesRead) {
        const remainingPartBytes = maxPartSize - currentPart.size;
        const writeLength = Math.min(remainingPartBytes, read.bytesRead - offset);
        const chunk = buffer.subarray(offset, offset + writeLength);
        currentPart.hash.update(chunk);
        if (!currentPart.stream.write(chunk)) {
          await once(currentPart.stream, "drain");
        }
        currentPart.size += writeLength;
        offset += writeLength;

        if (currentPart.size >= maxPartSize) {
          parts.push(await finishPartWriter(currentPart));
          partIndex += 1;
          currentPart = createPartWriter(partDir, partIndex);
        }
      }
    }
  } finally {
    await source.close();
  }

  if (currentPart.size > 0) {
    parts.push(await finishPartWriter(currentPart));
  } else {
    currentPart.stream.destroy();
    fs.rmSync(currentPart.path, { force: true });
  }

  return parts;
}

function createPartWriter(partDir, index) {
  const name = `part-${String(index).padStart(4, "0")}`;
  const partPath = path.join(partDir, name);
  return {
    name,
    path: partPath,
    stream: fs.createWriteStream(partPath),
    hash: crypto.createHash("sha256"),
    size: 0,
  };
}

function finishPartWriter(part) {
  return new Promise((resolve, reject) => {
    part.stream.on("error", reject);
    part.stream.end(() => {
      resolve({
        name: part.name,
        path: part.path,
        size: part.size,
        sha256: part.hash.digest("hex"),
      });
    });
  });
}

async function uploadObject({ key, filePath, contentType, cacheControl }) {
  const fileSize = fs.statSync(filePath).size;
  const publicUrl = getPublicUrlForKey(key);
  if (publicUrl) {
    const remoteSize = await getRemoteContentLength(publicUrl);
    if (remoteSize === fileSize) {
      console.log(`Skipping existing R2 object ${publicUrl}`);
      return;
    }
  }

  const objectPath = `${bucket}/${key}`;
  console.log(`Uploading ${filePath} to r2://${objectPath}`);
  runWrangler(
    [
      "r2",
      "object",
      "put",
      objectPath,
      "--remote",
      `--file=${filePath}`,
      `--content-type=${contentType}`,
      `--cache-control=${cacheControl}`,
    ],
    { inherit: true },
  );
}

function getPublicUrlForKey(key) {
  if (!mirrorUrl) {
    return "";
  }

  const normalizedKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
  const keyWithoutPrefix =
    prefix && normalizedKey.startsWith(`${prefix}/`)
      ? normalizedKey.slice(prefix.length + 1)
      : normalizedKey;
  return joinUrl(mirrorUrl, keyWithoutPrefix);
}

function getRemoteContentLength(url) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.request(parsedUrl, { method: "HEAD" }, (response) => {
      const length = Number(response.headers["content-length"] ?? 0);
      response.resume();
      resolve(response.statusCode === 200 && Number.isFinite(length) ? length : -1);
    });
    request.on("error", () => resolve(-1));
    request.setTimeout(15_000, () => {
      request.destroy();
      resolve(-1);
    });
    request.end();
  });
}

function getConfiguredArtifacts() {
  const configuredArtifacts =
    modelConfig.artifacts && typeof modelConfig.artifacts === "object"
      ? modelConfig.artifacts
      : {};

  return Object.entries(configuredArtifacts).map(([model, artifact]) => {
    const fileName =
      typeof artifact.fileName === "string" && artifact.fileName.trim()
        ? artifact.fileName.trim()
        : `${sanitizeModelName(model)}.gguf`;
    const localPath =
      typeof artifact.path === "string" && artifact.path.trim()
        ? resolveWorkspacePath(artifact.path.trim())
        : path.join(artifactDir, fileName);
    const remotePath =
      typeof artifact.remotePath === "string" && artifact.remotePath.trim()
        ? artifact.remotePath.trim()
        : fileName;
    const objectKey = joinKey(prefix, remotePath);
    const sha256 = normalizeSha256(artifact.sha256);

    return { model, fileName, localPath, remotePath, objectKey, sha256 };
  });
}

function printMirrorUrls(artifacts) {
  if (!mirrorUrl) {
    console.log("No mirror URL configured yet.");
    return;
  }

  console.log("\nMirror URLs:");
  for (const artifact of artifacts) {
    console.log(`- ${artifact.model}: ${joinUrl(mirrorUrl, artifact.remotePath)}`);
  }
}

function ensureWranglerAvailable() {
  const result = runWrangler(["--version"], { allowFailure: true });
  if (result.status === 0) {
    return;
  }

  throw new Error(
    "Wrangler is required. Run `npm install`, then `npx wrangler login`, or set CLOUDFLARE_API_TOKEN and rerun this command.",
  );
}

function runWrangler(wranglerArgs, options = {}) {
  const commandParts = getWranglerCommand();
  const result = spawnSync(commandParts.command, [...commandParts.args, ...wranglerArgs], {
    cwd: root,
    env: process.env,
    encoding: options.inherit ? undefined : "utf8",
    shell: false,
    stdio: options.inherit ? "inherit" : "pipe",
  });

  if (!options.inherit && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (!options.inherit && result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`Wrangler command failed: ${wranglerArgs.join(" ")}`);
  }

  return result;
}

function getWranglerCommand() {
  const localBin = path.join(
    root,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );

  if (fs.existsSync(localBin)) {
    return { command: process.execPath, args: [localBin] };
  }

  return {
    command: process.execPath,
    args: [path.join(root, "node_modules", ".bin", "wrangler")],
  };
}

function writeEnvValue(key, value) {
  requireMirrorUrl();
  const existing = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    : [];
  let replaced = false;
  const nextLines = existing.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!replaced) {
    nextLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(
    envPath,
    `${nextLines.filter((line, index) => line || index < nextLines.length - 1).join("\n")}\n`,
  );
}

function writeModelConfigMirrorUrl(value) {
  const configPath = path.join(root, "config", "local-models.json");
  const nextConfig = {
    ...modelConfig,
    mirrorBaseUrl: value,
  };
  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}

function requireMirrorUrl() {
  if (!mirrorUrl) {
    throw new Error(
      "A mirror URL is required. Pass --domain models.example.com or --mirror-url https://models.example.com/ecc.",
    );
  }
}

function parseArgs(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }

    const nextValue = values[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      parsed[key] = nextValue;
      index += 1;
      continue;
    }

    parsed[key] = true;
  }

  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
    input.on("error", reject);
  });
}

function sanitizeModelName(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function resolveWorkspacePath(value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function normalizePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function joinKey(...parts) {
  return parts
    .map((part) => String(part || "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function joinUrl(baseUrl, remotePath) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const suffix = String(remotePath || "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return suffix ? `${base}/${suffix}` : base;
}

function normalizeSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : "";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`R2 model mirror setup

Usage:
  node scripts/r2-model-mirror.mjs setup --bucket ecc-local-models --domain models.example.com
  node scripts/r2-model-mirror.mjs upload --bucket ecc-local-models --mirror-url https://models.example.com/ecc
  node scripts/r2-model-mirror.mjs env --mirror-url https://models.example.com/ecc
  node scripts/r2-model-mirror.mjs urls --mirror-url https://models.example.com/ecc

Options:
  --bucket <name>         R2 bucket name. Default: ecc-local-models
  --domain <host>         Custom domain connected to the R2 bucket.
  --mirror-url <url>      Exact public base URL for OLLAMA_MODEL_MIRROR_BASE_URL.
  --prefix <path>         Object key prefix. Default: ecc
  --artifact-dir <path>   Local GGUF artifact folder. Default: .cache/ollama-models
  --location <hint>       Optional R2 location hint, such as enam or wnam.
  --jurisdiction <value>  Optional R2 jurisdiction, such as eu.
  --dev-url               Enable Cloudflare's non-production r2.dev URL.
  --chunk-mb <size>       Chunk size for files over Wrangler's upload limit. Default: 256.
  --env-path <path>       Env file to update. Default: .env.local
  --no-write-config       Do not save mirrorBaseUrl to config/local-models.json.
`);
}
