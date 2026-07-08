#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupOnly = process.argv.includes("--setup-only");
const modelsOnly = process.argv.includes("--models-only");
const modelConfig = readModelConfig();
const systemMemoryGb = os.totalmem() / 1024 ** 3;
const modelProfileName = selectModelProfileName();
const modelProfile = modelConfig.profiles[modelProfileName];
let model = process.env.OLLAMA_MODEL || modelProfile.chat;
let voiceModel = process.env.OLLAMA_VOICE_MODEL || modelProfile.voice;
let visionModel = process.env.OLLAMA_VISION_MODEL || modelProfile.vision;
const explicitModel = Boolean(
  process.env.OLLAMA_MODEL && process.env.OLLAMA_MODEL !== modelProfile.chat,
);
const explicitVoiceModel = Boolean(
  process.env.OLLAMA_VOICE_MODEL &&
    process.env.OLLAMA_VOICE_MODEL !== modelProfile.voice,
);
const explicitVisionModel = Boolean(
  process.env.OLLAMA_VISION_MODEL &&
    process.env.OLLAMA_VISION_MODEL !== modelProfile.vision,
);
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const modelArtifactDir = path.resolve(
  root,
  process.env.OLLAMA_MODEL_ARTIFACT_DIR || path.join(".cache", "ollama-models"),
);
const modelMirrorBaseUrl = normalizeOptionalUrl(
  process.env.OLLAMA_MODEL_MIRROR_BASE_URL || modelConfig.mirrorBaseUrl,
);
const modelMirrorBrowserDownloaderUrl = modelMirrorBaseUrl
  ? joinUrl(modelMirrorBaseUrl, "model-downloader.html")
  : "";
const registryFallbackDisabled = parseBoolean(
  process.env.OLLAMA_DISABLE_REGISTRY_FALLBACK,
  Boolean(modelConfig.disableRegistryFallback),
);
const modelDownloadTimeoutMs = parsePositiveInteger(
  process.env.OLLAMA_MODEL_DOWNLOAD_TIMEOUT_MS,
  30 * 60 * 1000,
);
const modelMirrorUserAgent =
  process.env.OLLAMA_MODEL_MIRROR_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const browserModelDownloadEnabled = parseBoolean(
  process.env.OLLAMA_MODEL_BROWSER_DOWNLOAD,
  true,
);
const manualBrowserDownloaderPromptEnabled = parseBoolean(
  process.env.OLLAMA_MODEL_MANUAL_BROWSER_PROMPT,
  false,
);
const npmCommand = process.env.npm_execpath
  ? process.execPath
  : process.platform === "win32"
    ? "npm.cmd"
    : "npm";
const npmArgsPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
let browserDownloaderPromptShown = false;

main().catch((error) => {
  console.error(`\nLocal startup failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  printHeader();
  requireSupportedNode();
  requireCommand(npmCommand, [...npmArgsPrefix, "--version"], "npm");
  requireCommand(
    "ollama",
    ["--version"],
    "Ollama. Install it from https://ollama.com/download, then rerun this command.",
  );

  if (!modelsOnly) {
    run("Installing project dependencies", npmCommand, [...npmArgsPrefix, "install"]);
  }

  await ensureOllamaServer();
  model = await resolveAdaptiveOllamaModel({
    role: "chat",
    label: "text chat",
    requestedName: model,
    fallbackNames: modelConfig.fallbacks.chat,
    explicit: explicitModel,
  });
  voiceModel = await resolveAdaptiveOllamaModel({
    role: "voice",
    label: "voice chat",
    requestedName: voiceModel,
    fallbackNames: modelConfig.fallbacks.voice,
    explicit: explicitVoiceModel,
  });
  visionModel = await resolveAdaptiveOllamaModel({
    role: "vision",
    label: "screenshots",
    requestedName: visionModel,
    fallbackNames: modelConfig.fallbacks.vision,
    explicit: explicitVisionModel,
  });
  persistResolvedModelEnv();
  printResolvedModels();

  if (modelsOnly) {
    console.log("\nLocal models are ready.");
    return;
  }

  if (setupOnly) {
    console.log("\nSetup complete. Run `npm run local` to start the tracker.");
    return;
  }

  console.log("\nStarting local Convex and Next.js...");
  console.log("Open http://localhost:3000 when the server is ready.\n");

  const child = spawn(npmCommand, [...npmArgsPrefix, "run", "dev:local"], {
    cwd: root,
    env: {
      ...process.env,
      OLLAMA_MODEL: model,
      OLLAMA_VOICE_MODEL: voiceModel,
      OLLAMA_VISION_MODEL: visionModel,
      OLLAMA_BASE_URL: ollamaBaseUrl,
      LOCAL_MODEL_PROFILE: modelProfileName,
    },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function requireSupportedNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 20) {
    throw new Error(
      `Node.js 20 or newer is required. Current version is ${process.versions.node}. Run scripts/start-local for automatic prerequisite installation.`,
    );
  }
}

function printHeader() {
  console.log("Local CR Tracker");
  console.log("================");
  console.log(`Workspace: ${root}`);
  console.log(`Ollama: ${ollamaBaseUrl}`);
  if (modelMirrorBaseUrl) {
    console.log(`Model mirror: ${modelMirrorBaseUrl}`);
  }
  console.log(
    `Ollama registry fallback: ${registryFallbackDisabled ? "disabled" : "enabled"}`,
  );
  console.log(`System memory: ${systemMemoryGb.toFixed(1)} GB`);
  console.log(
    `Model profile: ${modelProfileName}${process.env.LOCAL_MODEL_PROFILE ? " (configured)" : " (auto)"}`,
  );
  console.log(`Seed text model: ${model}`);
  console.log(`Seed voice model: ${voiceModel}`);
  console.log(`Seed vision model: ${visionModel}\n`);
}

function printResolvedModels() {
  console.log("\nResolved local models:");
  console.log(`- Text: ${model}`);
  console.log(`- Voice: ${voiceModel}`);
  console.log(`- Screenshots: ${visionModel}`);
  console.log("- Saved model choices to .env.local");
}

function requireCommand(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw new Error(`Missing ${label}`);
  }
}

function run(label, command, args) {
  console.log(`${label}...`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
}

async function ensureOllamaServer() {
  if (await canReachOllama()) {
    console.log("Ollama server is running.");
    return;
  }

  console.log("Starting Ollama server...");
  const server = spawn("ollama", ["serve"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  server.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await canReachOllama()) {
      console.log("Ollama server is ready.");
      return;
    }
    await sleep(750);
  }

  throw new Error(
    `Ollama did not become reachable at ${ollamaBaseUrl}. Start it manually with \`ollama serve\` and rerun this command.`,
  );
}

async function resolveAdaptiveOllamaModel({
  role,
  label,
  requestedName,
  fallbackNames,
  explicit,
}) {
  if (explicit) {
    if (await ensureOllamaModel(requestedName)) {
      return requestedName;
    }

    throw new Error(
      `Could not install explicitly configured ${label} model ${requestedName}.`,
    );
  }

  const installedModels = await getOllamaModels();
  const rankedCandidates = rankModelCandidates(role, installedModels);
  let candidates = unique([...rankedCandidates, requestedName, ...fallbackNames]);
  if (registryFallbackDisabled) {
    candidates = candidates.filter((candidate) =>
      canInstallWithoutRegistry(candidate, installedModels),
    );
  }
  console.log(
    `Adaptive ${label} candidates: ${previewCandidateList(candidates)}.`,
  );

  const firstCandidate = candidates[0] ?? requestedName;
  for (const candidate of candidates) {
    if (candidate !== firstCandidate) {
      console.warn(
        `Trying ${candidate} for ${label} because ${firstCandidate} was not available.`,
      );
    }
    if (await ensureOllamaModel(candidate)) {
      return candidate;
    }
  }

  if (await promptForBrowserModelDownload(label)) {
    for (const candidate of candidates) {
      if (await ensureOllamaModel(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(formatModelInstallFailure(label));
}

function rankModelCandidates(role, installedModels) {
  const candidates = Array.isArray(modelConfig.candidates?.[role])
    ? modelConfig.candidates[role]
    : [];
  if (candidates.length === 0) {
    return [];
  }

  const compatibleCandidates = candidates.filter((candidate) =>
    isCandidateCompatible(candidate),
  );
  const pool = compatibleCandidates.length > 0 ? compatibleCandidates : candidates;
  const weights = normalizeWeights(modelConfig.weights?.[modelProfileName]?.[role]);
  const installedSet = new Set(installedModels);
  const installedBonus = Number(modelConfig.installedBonus?.[modelProfileName] ?? 0);

  return pool
    .map((candidate) => ({
      name: candidate.name,
      score: scoreModelCandidate(candidate, weights, installedSet, installedBonus),
    }))
    .filter((candidate) => typeof candidate.name === "string" && candidate.name)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.name);
}

function scoreModelCandidate(candidate, weights, installedSet, installedBonus) {
  const quality = Number(candidate.quality ?? 0);
  const speed = Number(candidate.speed ?? 0);
  const memoryPenalty =
    typeof candidate.minRamGb === "number" && candidate.minRamGb > systemMemoryGb
      ? (candidate.minRamGb - systemMemoryGb) * 0.3
      : 0;
  const cachedBonus = installedSet.has(candidate.name) ? installedBonus : 0;

  return quality * weights.quality + speed * weights.speed + cachedBonus - memoryPenalty;
}

function isCandidateCompatible(candidate) {
  return (
    typeof candidate.minRamGb !== "number" || candidate.minRamGb <= systemMemoryGb
  );
}

function normalizeWeights(weights) {
  const quality = Number(weights?.quality ?? 0.5);
  const speed = Number(weights?.speed ?? 0.5);
  const total = quality + speed;
  if (!Number.isFinite(total) || total <= 0) {
    return { quality: 0.5, speed: 0.5 };
  }

  return {
    quality: quality / total,
    speed: speed / total,
  };
}

function previewCandidateList(candidates) {
  const preview = candidates.slice(0, 4).join(", ");
  return candidates.length > 4 ? `${preview}, ...` : preview;
}

function canInstallWithoutRegistry(name, installedModels) {
  return (
    installedModels.includes(name) ||
    hasConfiguredModelArtifact(name) ||
    fs.existsSync(getModelArtifact(name).path)
  );
}

function hasConfiguredModelArtifact(name) {
  return Boolean(modelConfig.artifacts?.[name]);
}

async function ensureOllamaModel(name) {
  const models = await getOllamaModels();
  if (models.includes(name)) {
    console.log(`Model ${name} is already installed.`);
    return true;
  }

  const artifact = getModelArtifact(name);
  console.log(`Preparing ${name}. This can take a few minutes the first time...`);
  if (await ensureOllamaModelFromArtifact(name, artifact)) {
    return true;
  }

  if (registryFallbackDisabled) {
    console.warn(formatRegistryFallbackDisabledMessage(name, artifact));
    return false;
  }

  console.log(`Pulling ${name} from Ollama...`);
  return runOptional(`Pulling ${name}`, "ollama", ["pull", name]);
}

async function ensureOllamaModelFromArtifact(name, artifact = getModelArtifact(name)) {
  let hasArtifact = fs.existsSync(artifact.path);

  if (!hasArtifact && artifact.preferManifest && artifact.manifestUrl) {
    hasArtifact = await tryDownloadChunkedModelArtifact(name, artifact);
  }

  if (!hasArtifact && !artifact.preferManifest && artifact.url) {
    hasArtifact = await tryDownloadModelArtifact(name, artifact);
  }

  if (!hasArtifact) {
    return false;
  }

  console.log(`Using local model artifact for ${name}: ${artifact.path}`);

  if (artifact.sha256) {
    const actualHash = await sha256File(artifact.path);
    if (actualHash !== artifact.sha256) {
      console.warn(
        `Local model artifact hash mismatch for ${name}. Expected ${artifact.sha256}, got ${actualHash}.`,
      );
      return false;
    }
  }

  const modelfilePath = writeArtifactModelfile(name, artifact.path, artifact);
  return runOptional(`Creating ${name} from local artifact`, "ollama", [
    "create",
    name,
    "-f",
    modelfilePath,
  ], {
    cwd: path.dirname(artifact.path),
  });
}

async function tryDownloadModelArtifact(name, artifact) {
  console.log(`Downloading mirrored model artifact for ${name}...`);
  try {
    await downloadFile(artifact.url, artifact.path);
    return true;
  } catch (error) {
    console.warn(
      `Mirror download for ${name} failed: ${formatErrorMessage(error)}`,
    );
    return false;
  }
}

async function tryDownloadChunkedModelArtifact(name, artifact) {
  console.log(`Downloading chunked mirrored model artifact for ${name}...`);
  try {
    await downloadChunkedArtifact(artifact);
    return true;
  } catch (error) {
    console.warn(
      `Chunked mirror download for ${name} failed: ${formatErrorMessage(error)}`,
    );
    return false;
  }
}

function formatRegistryFallbackDisabledMessage(name, artifact) {
  const mirrorMessage = modelMirrorBaseUrl
    ? `or upload ${artifact.remotePath} to ${modelMirrorBaseUrl}`
    : "or configure OLLAMA_MODEL_MIRROR_BASE_URL";
  const parts = [
    `Skipping ollama pull for ${name} because registry fallback is disabled.`,
    `Put the artifact at ${artifact.path}, ${mirrorMessage}.`,
    "Set OLLAMA_DISABLE_REGISTRY_FALLBACK=0 to allow pulling from Ollama for this run.",
  ];
  if (modelMirrorBrowserDownloaderUrl) {
    parts.push(
      `If Chrome can download model files but command-line tools cannot, open ${modelMirrorBrowserDownloaderUrl} and select this repo folder.`,
    );
  }
  return parts.join(" ");
}

function formatModelInstallFailure(label) {
  if (!registryFallbackDisabled) {
    return `Could not install any local ${label} model.`;
  }

  const mirror = modelMirrorBaseUrl || "the configured model mirror";
  const parts = [
    `Could not install any local ${label} model from installed Ollama models, local GGUF artifacts, or ${mirror}.`,
    "Registry fallback is disabled to support corporate networks.",
    "Upload the missing GGUF artifacts to the mirror or set OLLAMA_DISABLE_REGISTRY_FALLBACK=0 to allow ollama pull.",
  ];
  if (modelMirrorBrowserDownloaderUrl) {
    parts.push(
      `If Chrome is allowed but Node, curl, or PowerShell are blocked, predownload the artifacts at ${modelMirrorBrowserDownloaderUrl}.`,
    );
  }
  return parts.join(" ");
}

async function promptForBrowserModelDownload(label) {
  if (
    browserDownloaderPromptShown ||
    !registryFallbackDisabled ||
    !modelMirrorBrowserDownloaderUrl ||
    !manualBrowserDownloaderPromptEnabled ||
    !process.stdin.isTTY ||
    process.env.CI
  ) {
    return false;
  }

  browserDownloaderPromptShown = true;
  console.warn(
    [
      "",
      "Command-line model downloads are blocked, but Chrome/Edge may still be allowed.",
      `Opening browser downloader: ${modelMirrorBrowserDownloaderUrl}`,
      `Select this repo folder when prompted: ${root}`,
      "When the browser page says Done, return here and press Enter to retry model setup.",
    ].join("\n"),
  );
  openUrlInDefaultBrowser(modelMirrorBrowserDownloaderUrl);
  await waitForEnter(`Press Enter after the browser downloader finishes ${label} models...`);
  return true;
}

function openUrlInDefaultBrowser(url) {
  const command =
    process.platform === "win32"
      ? "cmd.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  try {
    const child = spawn(command, args, {
      cwd: root,
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    console.warn(`Could not open browser automatically: ${error.message}`);
  }
}

async function waitForEnter(message) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await readline.question(`${message}\n`);
  } finally {
    readline.close();
  }
}

function getModelArtifact(name) {
  const configured = getConfiguredModelArtifact(name);
  const fileName =
    typeof configured.fileName === "string" && configured.fileName.trim()
      ? configured.fileName.trim()
      : `${sanitizeModelName(name)}.gguf`;
  const localPath =
    typeof configured.path === "string" && configured.path.trim()
      ? resolveWorkspacePath(configured.path.trim())
      : path.join(modelArtifactDir, fileName);
  const remotePath =
    typeof configured.remotePath === "string" && configured.remotePath.trim()
      ? configured.remotePath.trim()
      : fileName;
  const url =
    typeof configured.url === "string" && configured.url.trim()
      ? configured.url.trim()
      : modelMirrorBaseUrl
        ? joinUrl(modelMirrorBaseUrl, remotePath)
        : "";
  const manifestUrl =
    typeof configured.manifestUrl === "string" && configured.manifestUrl.trim()
      ? configured.manifestUrl.trim()
      : configured.preferManifest && url
        ? `${url}.manifest.json`
        : "";
  const manifestPath =
    typeof configured.manifestPath === "string" && configured.manifestPath.trim()
      ? resolveWorkspacePath(configured.manifestPath.trim())
      : "";

  return {
    path: localPath,
    remotePath,
    url,
    manifestUrl,
    manifestPath,
    preferManifest: Boolean(configured.preferManifest),
    sha256: normalizeSha256(configured.sha256),
    modelfile: normalizeModelfileLines(configured.modelfile),
  };
}

function getConfiguredModelArtifact(name) {
  const artifact = modelConfig.artifacts?.[name];
  return artifact && typeof artifact === "object" && !Array.isArray(artifact)
    ? artifact
    : {};
}

function writeArtifactModelfile(name, artifactPath, artifact) {
  const artifactDir = path.dirname(artifactPath);
  fs.mkdirSync(artifactDir, { recursive: true });

  const modelfilePath = path.join(
    artifactDir,
    `${sanitizeModelName(name)}.Modelfile`,
  );
  const artifactFileName = path.basename(artifactPath).replaceAll("\\", "/");
  const modelfileLines = [
    `FROM ${formatModelfilePath(`./${artifactFileName}`)}`,
    ...artifact.modelfile,
  ];

  fs.writeFileSync(modelfilePath, `${modelfileLines.join("\n")}\n`);
  return modelfilePath;
}

function formatModelfilePath(value) {
  return /[\s"#]/.test(value) ? JSON.stringify(value) : value;
}

function normalizeModelfileLines(value) {
  if (Array.isArray(value)) {
    return value.filter((line) => typeof line === "string" && line.trim());
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
  }

  return [];
}

async function downloadChunkedArtifact(artifact) {
  const manifest = await readArtifactManifest(artifact);
  if (!manifest || !Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    throw new Error("Chunk manifest did not include any parts");
  }

  fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
  const tempDir = `${artifact.path}.parts`;
  const tempArtifactPath = `${artifact.path}.download`;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(tempArtifactPath, { force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const manifestBaseUrl = artifact.manifestUrl.slice(
    0,
    artifact.manifestUrl.lastIndexOf("/") + 1,
  );
  const partPaths = [];

  for (let index = 0; index < manifest.parts.length; index += 1) {
    const part = manifest.parts[index];
    const partUrl = resolveManifestPartUrl(part, manifestBaseUrl);
    if (!partUrl) {
      throw new Error(`Chunk ${index + 1} did not include a path or URL`);
    }

    const partPath = path.join(tempDir, `part-${String(index).padStart(4, "0")}`);
    console.log(
      `Downloading model chunk ${index + 1} of ${manifest.parts.length}...`,
    );
    await downloadFile(partUrl, partPath);
    if (part.sha256) {
      const actualPartHash = await sha256File(partPath);
      const expectedPartHash = normalizeSha256(part.sha256);
      if (expectedPartHash && actualPartHash !== expectedPartHash) {
        throw new Error(
          `Chunk ${index + 1} hash mismatch. Expected ${expectedPartHash}, got ${actualPartHash}.`,
        );
      }
    }
    partPaths.push(partPath);
  }

  await concatenateFiles(partPaths, tempArtifactPath);
  fs.renameSync(tempArtifactPath, artifact.path);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function readArtifactManifest(artifact) {
  if (artifact.manifestPath) {
    try {
      return JSON.parse(fs.readFileSync(artifact.manifestPath, "utf8"));
    } catch (error) {
      console.warn(
        `Local chunk manifest ${artifact.manifestPath} could not be read: ${formatErrorMessage(error)}`,
      );
    }
  }

  return await requestJson(artifact.manifestUrl);
}

function resolveManifestPartUrl(part, manifestBaseUrl) {
  if (typeof part.url === "string" && part.url.trim()) {
    return part.url.trim();
  }

  const relativePath =
    typeof part.path === "string" && part.path.trim()
      ? part.path.trim()
      : typeof part.key === "string" && part.key.trim()
        ? part.key.trim()
        : "";
  return relativePath ? new URL(relativePath, manifestBaseUrl).toString() : "";
}

async function concatenateFiles(sourcePaths, targetPath) {
  const output = fs.createWriteStream(targetPath);
  try {
    for (const sourcePath of sourcePaths) {
      await pipeline(fs.createReadStream(sourcePath), output, { end: false });
    }
  } finally {
    await new Promise((resolve, reject) => {
      output.end((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function canReachOllama() {
  try {
    await requestJson(`${ollamaBaseUrl}/api/tags`);
    return true;
  } catch {
    return false;
  }
}

async function getOllamaModels() {
  const data = await requestJson(`${ollamaBaseUrl}/api/tags`);
  return Array.isArray(data.models)
    ? data.models
        .flatMap((entry) => [entry.name, entry.model])
        .filter((value) => typeof value === "string")
    : [];
}

async function requestJson(url) {
  try {
    return await requestJsonDirect(url);
  } catch (error) {
    if (!shouldUseCurlFallback(url, error)) {
      throw error;
    }
    return await requestJsonWithCurl(url, error);
  }
}

function requestJsonDirect(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.get(parsedUrl, getRequestOptions(url), (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(5_000, () => {
      request.destroy(new Error("Request timed out"));
    });
  });
}

async function requestJsonWithCurl(url, originalError) {
  const result = runCurl(
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--http1.1",
      "--user-agent",
      modelMirrorUserAgent,
      "--header",
      "Accept: */*",
      url,
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `${formatErrorMessage(originalError)}; curl fallback failed: ${formatCurlError(result)}`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`curl fallback returned invalid JSON: ${formatErrorMessage(error)}`);
  }
}

async function downloadFile(url, targetPath, redirectCount = 0) {
  try {
    return await downloadFileDirect(url, targetPath, redirectCount);
  } catch (error) {
    if (!shouldUseCurlFallback(url, error)) {
      throw error;
    }
    try {
      await downloadFileWithCurl(url, targetPath, error);
    } catch (curlError) {
      let fallbackError = curlError;
      if (process.platform === "win32") {
        try {
          await downloadFileWithPowerShell(url, targetPath, curlError);
          return;
        } catch (powerShellError) {
          fallbackError = powerShellError;
        }
      }

      if (!shouldUseBrowserFallback(url)) {
        throw fallbackError;
      }
      await downloadFileWithBrowser(url, targetPath, fallbackError);
    }
  }
}

function downloadFileDirect(url, targetPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects"));
      return;
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.download`;
    fs.rmSync(tempPath, { force: true });

    const request = client.get(parsedUrl, getRequestOptions(url), (response) => {
      const statusCode = response.statusCode ?? 500;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume();
        downloadFileDirect(new URL(location, parsedUrl).toString(), targetPath, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (statusCode >= 400) {
        response.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }

      const totalBytes = Number(response.headers["content-length"] ?? 0);
      let downloadedBytes = 0;
      let lastProgressAt = Date.now();
      const output = fs.createWriteStream(tempPath);

      response.on("data", (chunk) => {
        downloadedBytes += chunk.length;
        if (Date.now() - lastProgressAt >= 10_000) {
          lastProgressAt = Date.now();
          console.log(
            totalBytes > 0
              ? `Downloaded ${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}...`
              : `Downloaded ${formatBytes(downloadedBytes)}...`,
          );
        }
      });

      response.pipe(output);
      output.on("finish", () => {
        output.close(() => {
          fs.renameSync(tempPath, targetPath);
          resolve();
        });
      });
      output.on("error", (error) => {
        response.destroy();
        fs.rmSync(tempPath, { force: true });
        reject(error);
      });
    });

    request.on("error", (error) => {
      fs.rmSync(tempPath, { force: true });
      reject(error);
    });
    request.setTimeout(modelDownloadTimeoutMs, () => {
      request.destroy(new Error("Download timed out"));
    });
  });
}

async function downloadFileWithCurl(url, targetPath, originalError) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.download`;
  fs.rmSync(tempPath, { force: true });

  console.log(`Retrying download through curl: ${url}`);
  const result = runCurl(
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--http1.1",
      "--user-agent",
      modelMirrorUserAgent,
      "--header",
      "Accept: */*",
      "--retry",
      "3",
      "--connect-timeout",
      "30",
      "--max-time",
      String(Math.ceil(modelDownloadTimeoutMs / 1000)),
      "--output",
      tempPath,
      url,
    ],
    { timeout: modelDownloadTimeoutMs },
  );

  if (result.status !== 0) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(
      `${formatErrorMessage(originalError)}; curl fallback failed: ${formatCurlError(result)}`,
    );
  }

  fs.renameSync(tempPath, targetPath);
}

async function downloadFileWithPowerShell(url, targetPath, originalError) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.download`;
  fs.rmSync(tempPath, { force: true });

  console.log(`Retrying download through PowerShell: ${url}`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
    "$source = $env:MODEL_DOWNLOAD_URL",
    "$destination = $env:MODEL_DOWNLOAD_PATH",
    "$userAgent = $env:MODEL_DOWNLOAD_USER_AGENT",
    "$headers = @{ Accept = '*/*' }",
    "try {",
    "  Invoke-WebRequest -UseBasicParsing -Uri $source -OutFile $destination -UserAgent $userAgent -Headers $headers",
    "} catch {",
    "  if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {",
    "    Start-BitsTransfer -Source $source -Destination $destination -ErrorAction Stop",
    "  } else {",
    "    throw",
    "  }",
    "}",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MODEL_DOWNLOAD_URL: url,
        MODEL_DOWNLOAD_PATH: tempPath,
        MODEL_DOWNLOAD_USER_AGENT: modelMirrorUserAgent,
      },
      shell: false,
      timeout: modelDownloadTimeoutMs,
    },
  );

  if (result.status !== 0) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(
      `${formatErrorMessage(originalError)}; PowerShell fallback failed: ${formatProcessError(result)}`,
    );
  }

  fs.renameSync(tempPath, targetPath);
}

async function downloadFileWithBrowser(url, targetPath, originalError) {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    throw new Error(
      `${formatErrorMessage(originalError)}; browser fallback failed: Chrome or Edge was not found`,
    );
  }

  const targetDir = path.dirname(targetPath);
  const fileName = path.basename(targetPath);
  const profileDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "local-cr-tracker-browser-"),
  );
  fs.mkdirSync(targetDir, { recursive: true });
  fs.rmSync(targetPath, { force: true });
  fs.rmSync(`${targetPath}.crdownload`, { force: true });
  writeBrowserDownloadPreferences(profileDir, targetDir);

  console.log(`Retrying download through browser: ${url}`);
  const startedAt = Date.now();
  const child = spawn(browserPath, getBrowserDownloadArgs(profileDir, url), {
    cwd: root,
    detached: false,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code;
  });

  try {
    await waitForBrowserDownload(
      getBrowserDownloadDirs(targetDir),
      fileName,
      targetPath,
      startedAt,
      () => exitCode,
    );
  } catch (error) {
    throw new Error(
      `${formatErrorMessage(originalError)}; browser fallback failed: ${formatErrorMessage(error)}`,
    );
  } finally {
    stopBrowserProcess(child);
    await sleep(500);
    removePathBestEffort(profileDir, { recursive: true });
  }
}

function writeBrowserDownloadPreferences(profileDir, downloadDir) {
  const defaultDir = path.join(profileDir, "Default");
  fs.mkdirSync(defaultDir, { recursive: true });
  const preferences = {
    browser: {
      check_default_browser: false,
    },
    download: {
      default_directory: downloadDir,
      directory_upgrade: true,
      prompt_for_download: false,
    },
    profile: {
      default_content_setting_values: {
        automatic_downloads: 1,
      },
    },
  };
  fs.writeFileSync(
    path.join(defaultDir, "Preferences"),
    JSON.stringify(preferences),
  );
}

function getBrowserDownloadArgs(profileDir, url) {
  return [
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-popup-blocking",
    "--start-minimized",
    url,
  ];
}

function getBrowserDownloadDirs(preferredDir) {
  return unique([preferredDir, path.join(os.homedir(), "Downloads")]).filter(
    (downloadDir) => fs.existsSync(downloadDir),
  );
}

async function waitForBrowserDownload(
  downloadDirs,
  fileName,
  targetPath,
  startedAt,
  getExitCode,
) {
  let lastSize = -1;
  let stableSince = 0;

  while (Date.now() - startedAt < modelDownloadTimeoutMs) {
    const downloadedPath = findBrowserDownloadedFile(
      downloadDirs,
      fileName,
      startedAt,
    );
    const partialDownloads = findBrowserPartialDownloads(
      downloadDirs,
      fileName,
      startedAt,
    );

    if (downloadedPath && partialDownloads.length === 0) {
      const size = fs.statSync(downloadedPath).size;
      if (size > 0 && size === lastSize) {
        if (Date.now() - stableSince >= 1500) {
          if (downloadedPath !== targetPath) {
            moveFileSync(downloadedPath, targetPath);
          }
          return;
        }
      } else {
        lastSize = size;
        stableSince = Date.now();
      }
    }

    const exitCode = getExitCode();
    if (exitCode !== null && !downloadedPath && partialDownloads.length === 0) {
      throw new Error(`browser exited before downloading ${fileName}`);
    }

    await sleep(1000);
  }

  throw new Error(`timed out waiting for ${fileName}`);
}

function findBrowserDownloadedFile(downloadDirs, fileName, startedAt) {
  const duplicatePattern = new RegExp(
    `^${escapeRegExp(fileName)}(?: \\(\\d+\\))?$`,
  );

  for (const downloadDir of downloadDirs) {
    for (const entry of fs.readdirSync(downloadDir)) {
      if (!duplicatePattern.test(entry)) {
        continue;
      }
      const candidate = path.join(downloadDir, entry);
      const stat = fs.statSync(candidate);
      if (stat.isFile() && stat.mtimeMs >= startedAt - 2000) {
        return candidate;
      }
    }
  }

  return "";
}

function findBrowserPartialDownloads(downloadDirs, fileName, startedAt) {
  return downloadDirs.flatMap((downloadDir) =>
    fs
      .readdirSync(downloadDir)
      .filter(
        (entry) => {
          if (
            !entry.startsWith(fileName) ||
            (!entry.endsWith(".crdownload") && !entry.endsWith(".tmp"))
          ) {
            return false;
          }
          return fs.statSync(path.join(downloadDir, entry)).mtimeMs >= startedAt - 2000;
        },
      )
      .map((entry) => path.join(downloadDir, entry)),
  );
}

function moveFileSync(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
    fs.copyFileSync(sourcePath, targetPath);
    fs.rmSync(sourcePath, { force: true });
  }
}

function removePathBestEffort(targetPath, options = {}) {
  try {
    fs.rmSync(targetPath, {
      force: true,
      maxRetries: 5,
      recursive: Boolean(options.recursive),
      retryDelay: 500,
    });
  } catch (error) {
    console.warn(
      `Could not clean up temporary browser files at ${targetPath}: ${error.message}`,
    );
  }
}

function stopBrowserProcess(child) {
  if (!child.pid || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      stdio: "ignore",
      timeout: 10_000,
    });
    return;
  }

  child.kill("SIGTERM");
}

function findBrowserExecutable() {
  const configured = [
    process.env.OLLAMA_MODEL_BROWSER_PATH,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
  ].find((value) => typeof value === "string" && value.trim());
  if (configured && fs.existsSync(configured.trim())) {
    return configured.trim();
  }

  const candidates =
    process.platform === "win32"
      ? getWindowsBrowserCandidates()
      : process.platform === "darwin"
        ? getMacBrowserCandidates()
        : getLinuxBrowserCandidates();

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function getWindowsBrowserCandidates() {
  const programFiles = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  return [
    ...programFiles.flatMap((basePath) => [
      path.join(basePath, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(basePath, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]),
    ...findCommands(["chrome.exe", "msedge.exe"]),
  ];
}

function getMacBrowserCandidates() {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ...findCommands(["google-chrome", "microsoft-edge", "chromium"]),
  ];
}

function getLinuxBrowserCandidates() {
  return findCommands([
    "google-chrome",
    "google-chrome-stable",
    "microsoft-edge",
    "microsoft-edge-stable",
    "chromium",
    "chromium-browser",
  ]);
}

function findCommands(commands) {
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  return commands.flatMap((command) => {
    const result = spawnSync(lookupCommand, [command], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 5_000,
    });
    if (result.status !== 0 || typeof result.stdout !== "string") {
      return [];
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  });
}

function shouldUseCurlFallback(url, error) {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  const message = formatErrorMessage(error);
  return (
    message.includes("socket hang up") ||
    (message.includes("HTTP 403") && isMirrorUrl(url)) ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("Request timed out") ||
    message.includes("self signed certificate") ||
    message.includes("unable to verify") ||
    message.includes("certificate")
  );
}

function shouldUseBrowserFallback(url) {
  return browserModelDownloadEnabled && /^https?:\/\//i.test(url) && isMirrorUrl(url);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRequestOptions(url) {
  if (!isMirrorUrl(url)) {
    return {};
  }

  return {
    headers: {
      "User-Agent": modelMirrorUserAgent,
      Accept: "*/*",
    },
  };
}

function isMirrorUrl(url) {
  return Boolean(modelMirrorBaseUrl && url.startsWith(`${modelMirrorBaseUrl}/`));
}

function runCurl(args, options = {}) {
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  return spawnSync(command, args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    env: process.env,
    shell: false,
    timeout: options.timeout ?? 60_000,
  });
}

function formatCurlError(result) {
  return formatProcessError(result);
}

function formatProcessError(result) {
  if (result.error) {
    return result.error.message;
  }
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  return stderr || `process exited with status ${result.status}`;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOptional(label, command, args, options = {}) {
  console.log(`${label}...`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    console.warn(`${label} failed.`);
    return false;
  }

  return true;
}

function sanitizeModelName(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function resolveWorkspacePath(value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function joinUrl(baseUrl, remotePath) {
  const encodedPath = remotePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${encodedPath}`;
}

function normalizeOptionalUrl(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\/+$/, "")
    : "";
}

function normalizeSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : "";
}

function parseBoolean(value, fallback) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readModelConfig() {
  const configPath = path.join(root, "config", "local-models.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read local model config at ${configPath}: ${error.message}`,
    );
  }
}

function selectModelProfileName() {
  const configuredProfile = process.env.LOCAL_MODEL_PROFILE?.trim();
  const profileName =
    configuredProfile && configuredProfile !== "auto"
      ? configuredProfile
      : chooseAutoModelProfileName();

  if (!modelConfig.profiles[profileName]) {
    throw new Error(
      `Unknown LOCAL_MODEL_PROFILE=${profileName}. Use one of: ${Object.keys(
        modelConfig.profiles,
      ).join(", ")}.`,
    );
  }

  return profileName;
}

function chooseAutoModelProfileName() {
  if (systemMemoryGb >= 24) {
    return "quality";
  }
  return systemMemoryGb >= 12 ? "balanced" : "fast";
}

function unique(values) {
  return Array.from(
    new Set(values.filter((value) => typeof value === "string" && value)),
  );
}

function persistResolvedModelEnv() {
  const envPath = path.join(root, ".env.local");
  const nextValues = {
    LOCAL_MODEL_PROFILE: modelProfileName,
    OLLAMA_MODEL: model,
    OLLAMA_VOICE_MODEL: voiceModel,
    OLLAMA_VISION_MODEL: visionModel,
    OLLAMA_BASE_URL: ollamaBaseUrl,
    OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || "30m",
  };
  const existing = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    : [];
  const seen = new Set();
  const nextLines = existing.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !(match[1] in nextValues)) {
      return line;
    }

    const key = match[1];
    seen.add(key);
    return `${key}=${nextValues[key]}`;
  });

  for (const [key, value] of Object.entries(nextValues)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(
    envPath,
    `${nextLines.filter((line, index) => line || index < nextLines.length - 1).join("\n")}\n`,
  );
}
