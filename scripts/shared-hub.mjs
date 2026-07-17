import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function initializeSharedHub(sharedDataDir) {
  const root = path.resolve(sharedDataDir);
  const runtimeDir = path.join(root, ".ecc-sync");
  const eventsDir = path.join(runtimeDir, "events");
  const replicasDir = path.join(runtimeDir, "replicas");
  const accountsDir = path.join(runtimeDir, "accounts");
  const backupsDir = path.join(runtimeDir, "backups");
  const configPath = path.join(runtimeDir, "config.json");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.mkdirSync(replicasDir, { recursive: true });
  fs.mkdirSync(accountsDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });

  let config = readJson(configPath);
  if (!config) {
    const candidate = {
      version: 1,
      hubId: crypto.randomUUID(),
      syncSecret: crypto.randomBytes(32).toString("hex"),
      createdAt: Date.now(),
    };
    try {
      fs.writeFileSync(configPath, `${JSON.stringify(candidate, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      config = candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      config = readJson(configPath);
    }
  }

  if (
    config?.version !== 1 ||
    typeof config.hubId !== "string" ||
    typeof config.syncSecret !== "string"
  ) {
    throw new Error(`Invalid shared sync configuration: ${configPath}`);
  }

  return {
    root,
    runtimeDir,
    eventsDir,
    replicasDir,
    accountsDir,
    backupsDir,
    configPath,
    config,
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
