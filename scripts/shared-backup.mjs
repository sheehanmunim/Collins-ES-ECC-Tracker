import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import nextEnv from "@next/env";
import { initializeSharedHub } from "./shared-hub.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root);

export function maybeCreateSharedBackup({ hub, replicaId, force = false }) {
  const intervalMs =
    positiveInteger(process.env.ECC_BACKUP_INTERVAL_MINUTES, 360) * 60_000;
  const retentionMs =
    positiveInteger(process.env.ECC_BACKUP_RETENTION_DAYS, 30) * 86_400_000;
  const latestPath = path.join(hub.backupsDir, "latest.json");
  const latest = readJson(latestPath);
  if (!force && latest?.createdAt > Date.now() - intervalMs) return null;

  const lockPath = path.join(hub.backupsDir, ".backup.lock");
  if (!acquireLock(lockPath)) return null;
  try {
    const latestAfterLock = readJson(latestPath);
    if (!force && latestAfterLock?.createdAt > Date.now() - intervalMs) {
      return null;
    }

    const createdAt = Date.now();
    const stamp = new Date(createdAt)
      .toISOString()
      .replace(/[-:.]/g, "")
      .replace("Z", "Z");
    const baseName = `snapshot-${stamp}`;
    const snapshotPath = path.join(hub.backupsDir, `${baseName}.json.gz`);
    const manifestPath = path.join(hub.backupsDir, `${baseName}.manifest.json`);
    const snapshot = collectSnapshot(hub, createdAt, replicaId);
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)), {
      level: zlib.constants.Z_BEST_COMPRESSION,
    });
    const tempSnapshot = `${snapshotPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempSnapshot, compressed, { flag: "wx" });
    fs.renameSync(tempSnapshot, snapshotPath);

    const manifest = {
      version: 1,
      hubId: hub.config.hubId,
      createdAt,
      createdBy: replicaId,
      machine: os.hostname(),
      snapshotFile: path.basename(snapshotPath),
      sha256: sha256(compressed),
      bytes: compressed.length,
      eventCount: snapshot.events.length,
      accountCount: snapshot.accounts.length,
    };
    writeJsonAtomic(manifestPath, manifest);
    verifySharedBackup(hub, snapshotPath);
    writeJsonAtomic(latestPath, manifest);
    pruneBackups(hub.backupsDir, createdAt - retentionMs, baseName);
    return manifest;
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

export function verifySharedBackup(hub, requestedPath) {
  const snapshotPath = resolveSnapshotPath(hub.backupsDir, requestedPath);
  const manifestPath = snapshotPath.replace(/\.json\.gz$/, ".manifest.json");
  const manifest = readJson(manifestPath);
  if (!manifest || manifest.version !== 1) {
    throw new Error(`Backup manifest is missing or invalid: ${manifestPath}`);
  }
  const compressed = fs.readFileSync(snapshotPath);
  if (manifest.sha256 !== sha256(compressed)) {
    throw new Error(`Backup checksum failed: ${snapshotPath}`);
  }
  const snapshot = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
  if (
    snapshot?.version !== 1 ||
    snapshot.hubId !== hub.config.hubId ||
    !Array.isArray(snapshot.events) ||
    !Array.isArray(snapshot.accounts) ||
    snapshot.events.length !== manifest.eventCount ||
    snapshot.accounts.length !== manifest.accountCount
  ) {
    throw new Error(`Backup contents are invalid: ${snapshotPath}`);
  }
  return { manifest, snapshot, snapshotPath };
}

export function restoreSharedBackup(hub, requestedPath) {
  const { snapshot, snapshotPath } = verifySharedBackup(hub, requestedPath);
  let restoredEvents = 0;
  let restoredAccounts = 0;
  for (const item of snapshot.events) {
    const destination = safeRestorePath(hub.runtimeDir, item.path, "events");
    if (writeMissingJson(destination, item.value)) restoredEvents += 1;
  }
  for (const item of snapshot.accounts) {
    const destination = safeRestorePath(hub.runtimeDir, item.path, "accounts");
    if (writeMissingJson(destination, item.value)) restoredAccounts += 1;
  }
  return { snapshotPath, restoredEvents, restoredAccounts };
}

function collectSnapshot(hub, createdAt, replicaId) {
  return {
    version: 1,
    hubId: hub.config.hubId,
    createdAt,
    createdBy: replicaId,
    events: collectJsonFiles(hub.runtimeDir, hub.eventsDir),
    accounts: collectJsonFiles(hub.runtimeDir, hub.accountsDir),
  };
}

function collectJsonFiles(runtimeDir, directory) {
  const files = [];
  for (const filePath of walkJsonFiles(directory)) {
    const value = readJson(filePath);
    if (!value) throw new Error(`Cannot back up invalid JSON: ${filePath}`);
    files.push({
      path: path.relative(runtimeDir, filePath).replaceAll("\\", "/"),
      value,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function walkJsonFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJsonFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".json"))
      files.push(entryPath);
  }
  return files;
}

function acquireLock(lockPath) {
  try {
    const existing = fs.statSync(lockPath);
    if (existing.mtimeMs < Date.now() - 30 * 60_000) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({ machine: os.hostname(), pid: process.pid, createdAt: Date.now() })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

function pruneBackups(backupsDir, cutoff, currentBaseName) {
  const pattern = /^snapshot-(\d{8}T\d{9}Z)\.(json\.gz|manifest\.json)$/;
  for (const entry of fs.readdirSync(backupsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    if (entry.name.startsWith(currentBaseName)) continue;
    const filePath = path.join(backupsDir, entry.name);
    if (fs.statSync(filePath).mtimeMs < cutoff)
      fs.rmSync(filePath, { force: true });
  }
}

function resolveSnapshotPath(backupsDir, requestedPath) {
  const candidate = requestedPath
    ? path.resolve(requestedPath)
    : path.join(
        backupsDir,
        readJson(path.join(backupsDir, "latest.json"))?.snapshotFile ?? "",
      );
  if (!candidate.endsWith(".json.gz") || !fs.existsSync(candidate)) {
    throw new Error("A valid .json.gz shared backup is required.");
  }
  return candidate;
}

function safeRestorePath(runtimeDir, relativePath, expectedRoot) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.startsWith(`${expectedRoot}/`) ||
    relativePath.includes("..")
  ) {
    throw new Error(`Unsafe backup path: ${String(relativePath)}`);
  }
  const destination = path.resolve(runtimeDir, ...relativePath.split("/"));
  const rootPrefix = `${path.resolve(runtimeDir)}${path.sep}`.toLowerCase();
  if (!destination.toLowerCase().startsWith(rootPrefix)) {
    throw new Error(`Unsafe backup path: ${relativePath}`);
  }
  return destination;
}

function writeMissingJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  fs.rmSync(filePath, { force: true });
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const sharedDataDir = process.env.ECC_SHARED_DATA_DIR?.trim();
  if (!sharedDataDir) throw new Error("ECC_SHARED_DATA_DIR is required.");
  const hub = initializeSharedHub(sharedDataDir);
  const command = process.argv[2] ?? "now";
  if (command === "now") {
    const result = maybeCreateSharedBackup({
      hub,
      replicaId: `manual-${os.hostname()}`,
      force: true,
    });
    console.log(`Backup created: ${result.snapshotFile}`);
  } else if (command === "verify") {
    const result = verifySharedBackup(hub, process.argv[3]);
    console.log(
      `Backup verified: ${result.manifest.eventCount} events, ${result.manifest.accountCount} accounts.`,
    );
  } else if (command === "restore") {
    const result = restoreSharedBackup(hub, process.argv[3]);
    console.log(
      `Restore merged ${result.restoredEvents} events and ${result.restoredAccounts} accounts without overwriting newer files.`,
    );
  } else {
    throw new Error("Use: now, verify [snapshot], or restore <snapshot>.");
  }
}
