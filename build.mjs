#!/usr/bin/env node
/**
 * Production build entry used by Vercel.
 * Inlines the VITE_ env merge from scripts/with-app-env.mjs so a deploy still
 * builds when that helper is not on the builder filesystem.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { fileURLToPath } from "node:url";

function readAppEnv() {
  try {
    const parsed = JSON.parse(readFileSync(new URL("./.grok/app-env.json", import.meta.url), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const env = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.startsWith("VITE_") || typeof value !== "string") continue;
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function exitStatus(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return code ?? 1;
}

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(exitStatus(code, signal)));
  });
}

const env = { ...readAppEnv(), ...process.env };
const viteBin = fileURLToPath(new URL("./node_modules/vite/bin/vite.js", import.meta.url));
const buildCode = await run([viteBin, "build"], env);
if (buildCode !== 0) process.exit(buildCode);
process.exit(await run(["scripts/migrate.mjs"], env));
