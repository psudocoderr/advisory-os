import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertScriptTargetAllowed, mergeEnv } from "./db-target.mjs";

function readEnvFile(file) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return {};

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return env;

      const equals = trimmed.indexOf("=");
      if (equals === -1) return env;

      const key = trimmed.slice(0, equals).trim();
      let value = trimmed.slice(equals + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
      return env;
    }, {});
}

// Optional first argument: --local-only or --writes, see assertScriptTargetAllowed.
const argv = process.argv.slice(2);
const mode = argv[0] === "--local-only" ? "local-only" : argv[0] === "--writes" ? "writes" : null;
const [command, ...args] = mode ? argv.slice(1) : argv;
if (!command) {
  console.error("Usage: node scripts/with-env.mjs [--local-only | --writes] <command> [...args]");
  process.exit(1);
}

const env = mergeEnv({ ...readEnvFile(".env"), ...readEnvFile(".env.local") }, process.env);

if (mode) {
  try {
    const hosts = assertScriptTargetAllowed(mode, env);
    if (hosts.length)
      console.warn(`\n!!  ALLOW_DEPLOYED_DB=1: writing to a deployed database (${hosts.join(", ")}).\n`);
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(3);
  }
}

const result = spawnSync(command, args, { env, shell: true, stdio: "inherit" });

process.exit(result.status ?? 1);
