import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SharingMode = "documents" | "corporate" | "off" | "custom";

export type SharingSelection = {
  mode: SharingMode;
  path: string;
};

const selectionPath = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  ".convex",
  "shared-selection.json",
);
const supervisorStatusPath = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  ".convex",
  "shared-supervisor-status.json",
);
const documentsPath = path.join(os.homedir(), "Documents", "ECC Tracker");
const corporatePath = String.raw`\\huswlf0o\groups\Design Index\Ec&a Programs\PW Military ECC\Archive\ECC Tracker\Data`;

export function getSharingSelection(): SharingSelection {
  const saved = readJson(selectionPath);
  if (saved?.mode === "documents") {
    return { mode: "documents", path: savedDocumentsPath(saved) };
  }
  if (saved?.mode === "corporate") {
    return { mode: "corporate", path: corporatePath };
  }
  if (saved?.mode === "off") return { mode: "off", path: "" };
  if (saved?.mode === "custom" && typeof saved.path === "string") {
    return { mode: "custom", path: saved.path };
  }
  return resolveLegacySelection(
    process.env.ECC_SHARED_MODE,
    process.env.ECC_SHARED_DATA_DIR,
  );
}

export function saveSharingSelection(
  mode: "documents" | "corporate" | "off",
  requestedDocumentsPath?: string,
) {
  const saved = readJson(selectionPath);
  const selectedDocumentsPath =
    requestedDocumentsPath !== undefined
      ? prepareDocumentsPath(requestedDocumentsPath)
      : savedDocumentsPath(saved);
  const selection =
    mode === "documents"
      ? { mode, path: selectedDocumentsPath }
      : mode === "corporate"
        ? { mode, path: corporatePath }
        : { mode, path: "" };
  fs.mkdirSync(path.dirname(selectionPath), { recursive: true });
  const tempPath = `${selectionPath}.${process.pid}.tmp`;
  fs.rmSync(tempPath, { force: true });
  fs.writeFileSync(
    tempPath,
    `${JSON.stringify(
      {
        version: 1,
        ...selection,
        documentsPath: selectedDocumentsPath,
        updatedAt: Date.now(),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  fs.rmSync(selectionPath, { force: true });
  fs.renameSync(tempPath, selectionPath);
  return selection;
}

export function sharingOptions() {
  const saved = readJson(selectionPath);
  return {
    documents: savedDocumentsPath(saved),
    corporate: corporatePath,
    off: "",
  } as const;
}

export function sharingStatus() {
  const selection = getSharingSelection();
  const supervisor = readJson(supervisorStatusPath);
  return {
    ...selection,
    reachable:
      selection.mode === "off" ||
      fs.existsSync(/* turbopackIgnore: true */ selection.path),
    syncState:
      supervisor?.mode === selection.mode && supervisor?.path === selection.path
        ? supervisor.state
        : selection.mode === "off"
          ? "off"
          : "switching",
    lastSyncAt:
      typeof supervisor?.lastSyncAt === "number" ? supervisor.lastSyncAt : null,
    message: typeof supervisor?.message === "string" ? supervisor.message : "",
  };
}

function resolveLegacySelection(
  modeValue: string | undefined,
  pathValue: string | undefined,
): SharingSelection {
  const mode = modeValue?.trim().toLowerCase();
  if (mode === "documents" || mode === "personal") {
    return { mode: "documents", path: documentsPath };
  }
  if (mode === "corporate") {
    return { mode: "corporate", path: corporatePath };
  }
  if (mode === "off" || mode === "none" || mode === "local") {
    return { mode: "off", path: "" };
  }
  const configuredPath = pathValue?.trim() ?? "";
  if (!configuredPath) return { mode: "corporate", path: corporatePath };
  if (samePath(configuredPath, documentsPath)) {
    return { mode: "documents", path: documentsPath };
  }
  if (samePath(configuredPath, corporatePath)) {
    return { mode: "corporate", path: corporatePath };
  }
  return { mode: "custom", path: configuredPath };
}

function savedDocumentsPath(saved: Record<string, unknown> | null) {
  if (typeof saved?.documentsPath === "string" && saved.documentsPath.trim()) {
    return saved.documentsPath.trim();
  }
  if (
    saved?.mode === "documents" &&
    typeof saved.path === "string" &&
    saved.path.trim()
  ) {
    return saved.path.trim();
  }
  return documentsPath;
}

function prepareDocumentsPath(value: string) {
  const selectedPath = value.trim();
  if (!selectedPath || !path.isAbsolute(selectedPath)) {
    throw new Error("Enter an absolute Documents hub folder path.");
  }
  fs.mkdirSync(/* turbopackIgnore: true */ selectedPath, { recursive: true });
  if (!fs.statSync(/* turbopackIgnore: true */ selectedPath).isDirectory()) {
    throw new Error("The Documents hub path must be a folder.");
  }
  return path.resolve(selectedPath);
}

function samePath(left: string, right: string) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(
      fs.readFileSync(/* turbopackIgnore: true */ filePath, "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}
