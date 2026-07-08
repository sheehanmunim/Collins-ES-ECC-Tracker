#!/usr/bin/env node

import crypto from "node:crypto";
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
const multipartUploadPartBytes =
  parsePositiveInteger(args.multipartMb || process.env.R2_MODEL_MULTIPART_MB, 64) *
  1024 *
  1024;
let largeObjectUploader = null;

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
        "Use --domain models.fourechelon.com, or --dev-url for Cloudflare's non-production r2.dev URL.",
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
  try {
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

      await uploadObject({
        key: artifact.objectKey,
        filePath: artifact.localPath,
        contentType: "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      });
      uploadedCount += 1;
    }
  } finally {
    cleanupLargeObjectUploader();
  }

  console.log(`Uploaded ${uploadedCount} model artifact(s).`);
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
  if (fileSize > maxWranglerUploadBytes) {
    const uploader = await getLargeObjectUploader();
    await uploadLargeObjectWithWorker({
      workerUrl: uploader.url,
      token: uploader.token,
      key,
      filePath,
      contentType,
      cacheControl,
      fileSize,
    });
    return;
  }

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

async function getLargeObjectUploader() {
  if (largeObjectUploader) {
    return largeObjectUploader;
  }

  const name = `ecc-r2-full-uploader-${Date.now()}`;
  const token = crypto.randomBytes(32).toString("base64url");
  const workDir = path.join(root, ".cache", name);
  fs.mkdirSync(workDir, { recursive: true });
  const workerPath = path.join(workDir, "worker.js");
  const configPath = path.join(workDir, "wrangler.toml");

  fs.writeFileSync(workerPath, getLargeObjectUploaderWorkerSource());
  fs.writeFileSync(
    configPath,
    [
      `name = "${name}"`,
      'main = "worker.js"',
      'compatibility_date = "2026-07-08"',
      "workers_dev = true",
      "",
      "[[r2_buckets]]",
      'binding = "MODELS"',
      `bucket_name = "${bucket}"`,
      "",
      "[vars]",
      `UPLOAD_TOKEN = "${token}"`,
      "",
    ].join("\n"),
  );

  console.log("Deploying temporary R2 full-object uploader...");
  const deploy = runWrangler(["deploy", "--config", configPath]);
  const output = `${deploy.stdout || ""}\n${deploy.stderr || ""}`;
  const url = output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
  if (!url) {
    cleanupTempDirectory(workDir);
    throw new Error("Could not find temporary uploader URL in Wrangler output.");
  }

  largeObjectUploader = { name, token, url, workDir, configPath };
  return largeObjectUploader;
}

function cleanupLargeObjectUploader() {
  if (!largeObjectUploader) {
    return;
  }

  try {
    runWrangler([
      "delete",
      "--name",
      largeObjectUploader.name,
      "--force",
    ]);
  } catch (error) {
    console.warn(`Could not delete temporary uploader Worker: ${error.message}`);
  }

  cleanupTempDirectory(largeObjectUploader.workDir);
  largeObjectUploader = null;
}

function cleanupTempDirectory(directoryPath) {
  try {
    fs.rmSync(directoryPath, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 500,
    });
  } catch (error) {
    console.warn(`Could not clean up ${directoryPath}: ${error.message}`);
  }
}

async function uploadLargeObjectWithWorker({
  workerUrl,
  token,
  key,
  filePath,
  contentType,
  cacheControl,
  fileSize,
}) {
  console.log(
    `Uploading ${filePath} as one R2 object via temporary Worker: r2://${bucket}/${key}`,
  );
  const { uploadId } = await requestUploaderJson({
    workerUrl,
    token,
    method: "POST",
    query: {
      action: "create",
      key,
      contentType,
      cacheControl,
    },
  });
  const file = await fs.promises.open(filePath, "r");
  const parts = [];
  let offset = 0;
  let partNumber = 1;

  try {
    while (offset < fileSize) {
      const length = Math.min(multipartUploadPartBytes, fileSize - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      const body = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      const part = await requestUploaderJson({
        workerUrl,
        token,
        method: "PUT",
        query: {
          action: "part",
          key,
          uploadId,
          partNumber: String(partNumber),
        },
        body,
      });
      parts.push(part);
      offset += bytesRead;
      console.log(
        `${key}: uploaded part ${partNumber} (${formatBytes(offset)} of ${formatBytes(fileSize)})`,
      );
      partNumber += 1;
    }
  } catch (error) {
    await requestUploaderJson({
      workerUrl,
      token,
      method: "POST",
      query: { action: "abort", key, uploadId },
    }).catch(() => {});
    throw error;
  } finally {
    await file.close();
  }

  const completed = await requestUploaderJson({
    workerUrl,
    token,
    method: "POST",
    query: {
      action: "complete",
      key,
      uploadId,
    },
    body: Buffer.from(JSON.stringify(parts)),
    headers: { "content-type": "application/json" },
  });
  console.log(`Completed ${key}: ${formatBytes(completed.size)}`);
}

async function requestUploaderJson({
  workerUrl,
  token,
  method,
  query,
  body,
  headers = {},
}) {
  const url = new URL(workerUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    body,
    headers: {
      authorization: `Bearer ${token}`,
      ...headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${url.searchParams.get("action")} failed: HTTP ${response.status} ${text}`,
    );
  }
  return JSON.parse(text);
}

function getLargeObjectUploaderWorkerSource() {
  return `function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requireUploadToken(request, env) {
  const expected = env.UPLOAD_TOKEN;
  const actual = request.headers.get("authorization") || "";
  return expected && actual === \`Bearer \${expected}\`;
}

function requireKey(url) {
  const key = url.searchParams.get("key") || "";
  if (!key.startsWith("ecc/") || key.includes("..")) {
    throw new Error("Invalid key");
  }
  return key;
}

export default {
  async fetch(request, env) {
    if (!requireUploadToken(request, env)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    try {
      if (request.method === "POST" && action === "create") {
        const key = requireKey(url);
        const upload = await env.MODELS.createMultipartUpload(key, {
          httpMetadata: {
            contentType:
              url.searchParams.get("contentType") || "application/octet-stream",
            cacheControl:
              url.searchParams.get("cacheControl") ||
              "public, max-age=31536000, immutable",
          },
        });
        return json({ key, uploadId: upload.uploadId });
      }

      if (request.method === "PUT" && action === "part") {
        const key = requireKey(url);
        const uploadId = url.searchParams.get("uploadId") || "";
        const partNumber = Number.parseInt(
          url.searchParams.get("partNumber") || "",
          10,
        );
        if (!uploadId || !Number.isInteger(partNumber) || partNumber <= 0) {
          return json({ error: "Invalid multipart part request" }, 400);
        }
        const upload = env.MODELS.resumeMultipartUpload(key, uploadId);
        const part = await upload.uploadPart(partNumber, request.body);
        return json({ partNumber: part.partNumber, etag: part.etag });
      }

      if (request.method === "POST" && action === "complete") {
        const key = requireKey(url);
        const uploadId = url.searchParams.get("uploadId") || "";
        const parts = await request.json();
        if (!uploadId || !Array.isArray(parts) || parts.length === 0) {
          return json({ error: "Invalid multipart complete request" }, 400);
        }
        const upload = env.MODELS.resumeMultipartUpload(key, uploadId);
        const object = await upload.complete(
          parts
            .map((part) => ({
              partNumber: Number(part.partNumber),
              etag: String(part.etag),
            }))
            .sort((left, right) => left.partNumber - right.partNumber),
        );
        return json({ key: object.key, size: object.size, etag: object.etag });
      }

      if (request.method === "POST" && action === "abort") {
        const key = requireKey(url);
        const uploadId = url.searchParams.get("uploadId") || "";
        if (!uploadId) {
          return json({ error: "Invalid multipart abort request" }, 400);
        }
        const upload = env.MODELS.resumeMultipartUpload(key, uploadId);
        await upload.abort();
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  },
};
`;
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
      "A mirror URL is required. Pass --domain models.fourechelon.com or --mirror-url https://models.fourechelon.com/ecc.",
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

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function printHelp() {
  console.log(`R2 model mirror setup

Usage:
  node scripts/r2-model-mirror.mjs setup --bucket ecc-local-models --domain models.fourechelon.com
  node scripts/r2-model-mirror.mjs upload --bucket ecc-local-models --mirror-url https://models.fourechelon.com/ecc
  node scripts/r2-model-mirror.mjs env --mirror-url https://models.fourechelon.com/ecc
  node scripts/r2-model-mirror.mjs urls --mirror-url https://models.fourechelon.com/ecc

Options:
  --bucket <name>         R2 bucket name. Default: ecc-local-models
  --domain <host>         Custom domain connected to the R2 bucket.
  --mirror-url <url>      Exact public base URL for OLLAMA_MODEL_MIRROR_BASE_URL.
  --prefix <path>         Object key prefix. Default: ecc
  --artifact-dir <path>   Local GGUF artifact folder. Default: .cache/ollama-models
  --location <hint>       Optional R2 location hint, such as enam or wnam.
  --jurisdiction <value>  Optional R2 jurisdiction, such as eu.
  --dev-url               Enable Cloudflare's non-production r2.dev URL.
  --multipart-mb <size>   Part size used only for maintainer-side full-object uploads. Default: 64.
  --env-path <path>       Env file to update. Default: .env.local
  --no-write-config       Do not save mirrorBaseUrl to config/local-models.json.
`);
}
