import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statusPath = path.join(root, ".convex", "shared-supervisor-status.json");
let child = null;
let activeKey = "";
let stopping = false;
let nextRetryAt = 0;
const intentionallyStopped = new WeakSet();

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

while (!stopping) {
  const selection = readSelection();
  const key = `${selection.mode}:${selection.path}`;
  if (key !== activeKey) {
    stopChild();
    activeKey = key;
    nextRetryAt = 0;
  }

  if (selection.mode === "off") {
    writeStatus({
      ...selection,
      state: "off",
      message: "Sharing is disabled.",
    });
  } else if (!fs.existsSync(selection.path)) {
    stopChild();
    writeStatus({
      ...selection,
      state: "local-fallback",
      message:
        "The selected shared folder is unavailable. Working locally until access returns.",
    });
    await delay(5_000);
    continue;
  } else if (!child && Date.now() >= nextRetryAt) {
    startSync(selection);
  }
  await delay(1_000);
}

stopChild();

function startSync(selection) {
  writeStatus({
    ...selection,
    state: "starting",
    message: "Starting shared sync.",
  });
  const syncProcess = spawn(
    process.execPath,
    [path.join(root, "scripts", "shared-sync.mjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        ECC_SHARED_MODE: selection.mode,
        ECC_SHARED_DATA_DIR: selection.path,
        ECC_SYNC_STATUS_PATH: statusPath,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  child = syncProcess;
  syncProcess.once("exit", (code, signal) => {
    if (child === syncProcess) child = null;
    if (stopping) return;
    if (intentionallyStopped.has(syncProcess)) return;
    nextRetryAt = Date.now() + 5_000;
    writeStatus({
      ...selection,
      state: "retrying",
      message: signal
        ? `Sync stopped by ${signal}; retrying.`
        : `Sync exited with code ${code ?? "unknown"}; retrying.`,
    });
  });
}

function stop() {
  stopping = true;
  stopChild();
}

function stopChild() {
  if (child && !child.killed) {
    intentionallyStopped.add(child);
    child.kill();
  }
  child = null;
}

function readSelection() {
  const saved = readJson(path.join(root, ".convex", "shared-selection.json"));
  const documentsPath = path.join(os.homedir(), "Documents", "ECC Tracker");
  const corporatePath = String.raw`\\huswlf0o\groups\Design Index\Ec&a Programs\PW Military ECC\Archive\ECC Tracker\Data`;
  if (saved?.mode === "documents")
    return {
      mode: "documents",
      path:
        (typeof saved.documentsPath === "string" &&
          saved.documentsPath.trim()) ||
        (typeof saved.path === "string" && saved.path.trim()) ||
        documentsPath,
    };
  if (saved?.mode === "corporate")
    return { mode: "corporate", path: corporatePath };
  if (saved?.mode === "off") return { mode: "off", path: "" };
  if (saved?.mode === "custom" && typeof saved.path === "string") {
    return { mode: "custom", path: saved.path };
  }
  const env = readEnvFile();
  const mode = env.ECC_SHARED_MODE?.toLowerCase();
  if (mode === "documents" || mode === "personal") {
    return { mode: "documents", path: documentsPath };
  }
  if (mode === "corporate") return { mode: "corporate", path: corporatePath };
  if (mode === "off") return { mode: "off", path: "" };
  if (!env.ECC_SHARED_DATA_DIR) {
    return { mode: "corporate", path: corporatePath };
  }
  return { mode: "custom", path: env.ECC_SHARED_DATA_DIR };
}

function readEnvFile() {
  const values = {};
  try {
    for (const line of fs
      .readFileSync(path.join(root, ".env.local"), "utf8")
      .split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2];
    }
  } catch {
    return values;
  }
  return values;
}

function writeStatus(status) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(
    statusPath,
    `${JSON.stringify({ version: 1, ...status, updatedAt: Date.now() }, null, 2)}\n`,
    "utf8",
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
