import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { ConvexHttpClient } from "convex/browser";
import { initializeSharedHub } from "./shared-hub.mjs";
import { maybeCreateSharedBackup } from "./shared-backup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(root);
const sharedDataDir = process.env.ECC_SHARED_DATA_DIR?.trim();
if (!sharedDataDir) process.exit(0);

const hub = initializeSharedHub(sharedDataDir);
const localConfigPath = path.join(
  root,
  ".convex",
  "local",
  "default",
  "config.json",
);
const localConfig = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
const convexUrl = `http://127.0.0.1:${localConfig.ports?.cloud ?? 3210}`;
const replicaIdPath = path.join(root, ".convex", "shared-replica-id");
const statePath = path.join(root, ".convex", "shared-sync-state.json");
const replicaId = readOrCreateReplicaId(replicaIdPath);
const savedState = readJson(statePath);
const seen = new Set(
  savedState?.hubId === hub.config.hubId ? (savedState.seen ?? []) : [],
);
const client = new ConvexHttpClient(convexUrl);
client.setAdminAuth(localConfig.adminKey);
let api;

let stopping = false;
process.once("SIGINT", () => (stopping = true));
process.once("SIGTERM", () => (stopping = true));

await waitForSyncFunctions();
await client.mutation(api.sync.configure, {
  secret: hub.config.syncSecret,
  hubId: hub.config.hubId,
});
await client.mutation(api.sync.seedOutbox, {
  secret: hub.config.syncSecret,
  hubId: hub.config.hubId,
});
console.log(`Shared-folder sync active: ${hub.root}`);

while (!stopping) {
  try {
    await importEvents();
    await publishOutbox();
    writeReplicaStatus();
    const backup = maybeCreateSharedBackup({ hub, replicaId });
    if (backup) console.log(`Shared backup created: ${backup.snapshotFile}`);
  } catch (error) {
    console.warn(`Shared-folder sync retrying: ${formatError(error)}`);
  }
  await delay(1_500);
}

async function waitForSyncFunctions() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const generatedApiUrl = pathToFileURL(
        path.join(root, "convex", "_generated", "api.js"),
      );
      generatedApiUrl.searchParams.set("attempt", String(Date.now()));
      const generated = await import(generatedApiUrl.href);
      if (!generated.api?.sync?.configure)
        throw new Error("Sync API not generated yet.");
      api = generated.api;
      await client.mutation(api.sync.configure, {
        secret: hub.config.syncSecret,
        hubId: hub.config.hubId,
      });
      return;
    } catch {
      await delay(750);
    }
  }
  throw new Error("Local Convex sync functions did not become ready.");
}

async function publishOutbox() {
  const rows = await client.query(api.sync.drainOutbox, {
    secret: hub.config.syncSecret,
  });
  if (!rows.length) return;
  const published = [];
  for (const row of rows) {
    const date = new Date(row.updatedAt);
    const partition = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const directory = path.join(hub.eventsDir, partition);
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(
      directory,
      `${row.updatedAt}-${row.eventId}.json`,
    );
    const event = {
      version: 1,
      eventId: row.eventId,
      entityType: row.entityType,
      entityKey: row.entityKey,
      updatedAt: row.updatedAt,
      origin: replicaId,
      payload: row.payload,
    };
    try {
      fs.writeFileSync(filePath, `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    seen.add(row.eventId);
    published.push(row.eventId);
  }
  saveState();
  await client.mutation(api.sync.acknowledgeOutbox, {
    secret: hub.config.syncSecret,
    eventIds: published,
  });
}

async function importEvents() {
  const events = [];
  for (const directory of listDirectories(hub.eventsDir)) {
    for (const filePath of listJsonFiles(directory)) {
      const event = readJson(filePath);
      if (!validEvent(event) || seen.has(event.eventId)) continue;
      events.push(event);
    }
  }
  events.sort(
    (left, right) =>
      left.updatedAt - right.updatedAt ||
      left.eventId.localeCompare(right.eventId),
  );
  for (let index = 0; index < events.length; index += 20) {
    const batch = events.slice(index, index + 20);
    const applied = await client.mutation(api.sync.applyEvents, {
      secret: hub.config.syncSecret,
      events: batch.map(
        ({ eventId, entityType, entityKey, updatedAt, payload }) => ({
          eventId,
          entityType,
          entityKey,
          updatedAt,
          payload,
        }),
      ),
    });
    for (const eventId of applied) seen.add(eventId);
    saveState();
  }
}

function writeReplicaStatus() {
  const filePath = path.join(hub.replicasDir, `${replicaId}.json`);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({
      version: 1,
      replicaId,
      machine: os.hostname(),
      updatedAt: Date.now(),
    })}\n`,
    "utf8",
  );
}

function saveState() {
  fs.writeFileSync(
    statePath,
    `${JSON.stringify({ hubId: hub.config.hubId, seen: [...seen] })}\n`,
    "utf8",
  );
}

function readOrCreateReplicaId(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    const value = crypto.randomUUID();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${value}\n`, "utf8");
    return value;
  }
}

function listDirectories(directory) {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function listJsonFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function validEvent(event) {
  return Boolean(
    event?.version === 1 &&
      typeof event.eventId === "string" &&
      (event.entityType === "cr" || event.entityType === "assistantChat") &&
      typeof event.entityKey === "string" &&
      Number.isFinite(event.updatedAt) &&
      typeof event.payload === "string",
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
