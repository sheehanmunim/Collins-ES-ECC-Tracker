#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupOnly = process.argv.includes("--setup-only");
const model = process.env.OLLAMA_MODEL || "qwen3:latest";
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const npmCommand = process.env.npm_execpath
  ? process.execPath
  : process.platform === "win32"
    ? "npm.cmd"
    : "npm";
const npmArgsPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];

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

  run("Installing project dependencies", npmCommand, [...npmArgsPrefix, "install"]);

  await ensureOllamaServer();
  await ensureOllamaModel(model);

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
      OLLAMA_BASE_URL: ollamaBaseUrl,
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
  console.log(`Model: ${model}\n`);
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

async function ensureOllamaModel(name) {
  const models = await getOllamaModels();
  if (models.includes(name)) {
    console.log(`Model ${name} is already installed.`);
    return;
  }

  console.log(`Pulling ${name}. This can take a few minutes the first time...`);
  run(`Pulling ${name}`, "ollama", ["pull", name]);
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

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
