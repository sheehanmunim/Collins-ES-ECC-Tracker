import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(/* turbopackIgnore: true */ process.cwd());
const checkIntervalMs = 5 * 60_000;
const gitTimeoutMs = 30_000;
let cachedStatus: AppUpdateStatus | null = null;
let statusPromise: Promise<AppUpdateStatus> | null = null;
let updatePromise: Promise<AppUpdateStatus> | null = null;

export type AppUpdateState =
  | "current"
  | "available"
  | "blocked"
  | "error"
  | "updated";

export type AppUpdateStatus = {
  state: AppUpdateState;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  message: string;
  checkedAt: number;
};

export async function getAppUpdateStatus(force = false) {
  if (
    !force &&
    cachedStatus &&
    cachedStatus.checkedAt > Date.now() - checkIntervalMs
  ) {
    return cachedStatus;
  }
  if (statusPromise) return await statusPromise;
  statusPromise = inspectUpdate().finally(() => {
    statusPromise = null;
  });
  cachedStatus = await statusPromise;
  return cachedStatus;
}

export async function applyAppUpdate() {
  if (updatePromise) return await updatePromise;
  updatePromise = performUpdate().finally(() => {
    updatePromise = null;
  });
  return await updatePromise;
}

async function performUpdate(): Promise<AppUpdateStatus> {
  const before = await inspectUpdate();
  if (before.state !== "available") return before;

  const upstreamCommit = await git(["rev-parse", "@{upstream}"]);
  if (!/^[a-f0-9]{40}$/i.test(upstreamCommit)) {
    return statusError(before, "The upstream commit could not be verified.");
  }

  try {
    await git(["merge", "--ff-only", upstreamCommit], 120_000);
  } catch (error) {
    return statusError(
      before,
      `Update could not be applied: ${errorMessage(error)}`,
    );
  }

  const after = await inspectUpdate(false);
  cachedStatus = {
    ...after,
    state: "updated",
    message:
      "Update downloaded successfully. Restart Collins ES ECC Tracker to finish.",
    checkedAt: Date.now(),
  };
  return cachedStatus;
}

async function inspectUpdate(fetchRemote = true): Promise<AppUpdateStatus> {
  const checkedAt = Date.now();
  try {
    const inside = await git(["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") {
      return baseStatus(
        "error",
        "This app is not running from a Git repository.",
        checkedAt,
      );
    }
    const branch = await git(["branch", "--show-current"]);
    if (!branch) {
      return baseStatus(
        "blocked",
        "Updates are unavailable on a detached Git commit.",
        checkedAt,
      );
    }
    let upstream = "";
    try {
      upstream = await git([
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]);
    } catch {
      return {
        ...baseStatus(
          "blocked",
          "This branch does not track a GitHub branch.",
          checkedAt,
        ),
        branch,
      };
    }
    if (fetchRemote) await git(["fetch", "--quiet", "--prune", "origin"]);
    const upstreamCommit = await git(["rev-parse", "@{upstream}"]);
    const counts = await git([
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${upstreamCommit}`,
    ]);
    const [ahead = 0, behind = 0] = counts
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10) || 0);
    const dirty = Boolean(
      await git(["status", "--porcelain", "--untracked-files=normal"]),
    );
    if (behind > 0 && (dirty || ahead > 0)) {
      return {
        state: "blocked",
        branch,
        upstream,
        ahead,
        behind,
        dirty,
        message: dirty
          ? "An update exists, but this installation has local code changes."
          : "An update exists, but this branch has diverged from GitHub.",
        checkedAt,
      };
    }
    if (behind > 0) {
      return {
        state: "available",
        branch,
        upstream,
        ahead,
        behind,
        dirty,
        message: `${behind} new commit${behind === 1 ? " is" : "s are"} available.`,
        checkedAt,
      };
    }
    return {
      state: "current",
      branch,
      upstream,
      ahead,
      behind,
      dirty,
      message: "Collins ES ECC Tracker is up to date.",
      checkedAt,
    };
  } catch (error) {
    return baseStatus(
      "error",
      `Could not check GitHub for updates: ${errorMessage(error)}`,
      checkedAt,
    );
  }
}

async function git(args: string[], timeout = gitTimeoutMs) {
  const result = await run("git", args, timeout);
  return result.stdout.trim();
}

async function run(command: string, args: string[], timeout: number) {
  return await execFileAsync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 10 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
}

function baseStatus(
  state: AppUpdateState,
  message: string,
  checkedAt: number,
): AppUpdateStatus {
  return {
    state,
    branch: "",
    upstream: "",
    ahead: 0,
    behind: 0,
    dirty: false,
    message,
    checkedAt,
  };
}

function statusError(
  status: AppUpdateStatus,
  message: string,
): AppUpdateStatus {
  cachedStatus = { ...status, state: "error", message, checkedAt: Date.now() };
  return cachedStatus;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.split(/\r?\n/)[0];
  return String(error);
}
