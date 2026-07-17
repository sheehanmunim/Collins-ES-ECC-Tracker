import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedApi = path.join(root, "convex", "_generated", "api.d.ts");
const privateEnv = path.join(root, ".convex", "private-local.env");
const localEnv = path.join(root, ".env.local");

const privateValues = readPrivateEnvironment();
if (!(await privateBackendIsReachable(privateValues))) {
  if (fs.existsSync(generatedApi)) {
    console.log(
      "Private local Convex is offline; using existing generated bindings.",
    );
    process.exit(0);
  }
  throw new Error(
    "Generated bindings are missing. Run npm run local once before building.",
  );
}

const originalLocalEnv = fs.existsSync(localEnv)
  ? fs.readFileSync(localEnv, "utf8")
  : null;
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "convex", "bin", "main.js"),
    "codegen",
    "--typecheck",
    "disable",
  ],
  {
    cwd: root,
    env: { ...process.env, ...privateValues, CONVEX_DEPLOYMENT: "" },
    stdio: "inherit",
    shell: false,
  },
);
if (
  originalLocalEnv !== null &&
  fs.readFileSync(localEnv, "utf8") !== originalLocalEnv
) {
  fs.writeFileSync(localEnv, originalLocalEnv, "utf8");
}
process.exit(result.status ?? 1);

async function privateBackendIsReachable(values) {
  if (!values.CONVEX_SELF_HOSTED_URL) return false;
  try {
    const response = await fetch(values.CONVEX_SELF_HOSTED_URL, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

function readPrivateEnvironment() {
  if (!fs.existsSync(privateEnv)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(privateEnv, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
