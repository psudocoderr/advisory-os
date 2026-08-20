import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-env.mjs <command> [...args]");
  process.exit(1);
}

const result = spawnSync(command, args, {
  env: {
    ...process.env,
    ...readEnvFile(".env"),
    ...readEnvFile(".env.local")
  },
  shell: true,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
