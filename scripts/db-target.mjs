/**
 * Classifies which database a command is about to act on, so destructive
 * operations can refuse to run anywhere they shouldn't.
 *
 * The environment matrix this implements is documented in
 * docs/engineering/runbook.md. Keep the two in sync.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);

/** Docker Compose / CI service names resolve to a container, not a managed database. */
const LOCAL_SERVICE_HOSTS = new Set(["postgres", "db", "database"]);

/**
 * @typedef {"local" | "ci" | "deployed" | "unknown"} TargetKind
 * @typedef {{ kind: TargetKind, host: string | null, ci: boolean, reason: string }} Target
 */

/**
 * Classification is driven by the HOST, never by CI. Running in CI does not
 * make a remote database disposable: a workflow whose DATABASE_URL points at
 * Supabase is pointed at production, and CI is exactly the context where
 * nobody is watching. `ci` is therefore only ever reported for a local host.
 *
 * Known limitation: this cannot see through a tunnel. ssh -L, cloud-sql-proxy
 * and kubectl port-forward all present a production database as localhost, and
 * this function will call that `local`. The row-count check in prisma/seed.ts
 * is the backstop for that case. See docs/engineering/adr/0003.
 *
 * @param {string | undefined} url
 * @returns {Target}
 */
export function classifyDatabaseTarget(url) {
  const ci = isCi();

  if (!url) {
    return { kind: "unknown", host: null, ci, reason: "no connection string was provided" };
  }

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return { kind: "unknown", host: null, ci, reason: "connection string could not be parsed" };
  }

  if (LOCAL_HOSTS.has(host) || LOCAL_SERVICE_HOSTS.has(host)) {
    const kind = ci ? "ci" : "local";
    return { kind, host, ci, reason: `${host} is an ephemeral ${kind} database` };
  }

  return {
    kind: "deployed",
    host,
    ci,
    reason: ci
      ? `${host} is a remote, managed database (running in CI does not make it disposable)`
      : `${host} is a remote, managed database`
  };
}

export function isCi() {
  return process.env.CI === "true" || process.env.CI === "1";
}

/** @param {Target} target */
export function isEphemeral(target) {
  return target.kind === "local" || target.kind === "ci";
}

/**
 * Throws unless the target database is safe to wipe.
 *
 * prisma/seed.ts begins by deleting every row in every table. Against a
 * deployed database that is unrecoverable without a backup restore, so the
 * default is refusal and the override has to be deliberate.
 *
 * @param {string | undefined} url
 * @param {{ operation?: string, overrideEnv?: string }} [options]
 */
export function assertDestructiveAllowed(url, options = {}) {
  const operation = options.operation ?? "This destructive operation";
  const overrideEnv = options.overrideEnv ?? "ALLOW_DESTRUCTIVE_SEED";
  const target = classifyDatabaseTarget(url);

  if (isEphemeral(target)) return target;

  if (process.env[overrideEnv] === "1") {
    console.warn(
      `\n!!  ${operation} is running against a ${target.kind} database (${target.host ?? "unknown host"}).` +
        `\n!!  ${overrideEnv}=1 was set, so the safety guard was bypassed deliberately.` +
        `\n!!  Every row will be deleted. Interrupt now if this was not intended.\n`
    );
    return target;
  }

  throw new Error(
    `${operation} refuses to run: ${target.reason}.\n` +
      `  Target host: ${target.host ?? "unknown"}\n` +
      `  Expected an ephemeral database (local Docker Compose, or a CI service container).\n\n` +
      `  If you genuinely mean to wipe this database, re-run with ${overrideEnv}=1.\n` +
      `  See docs/engineering/runbook.md for the environment matrix.`
  );
}

/**
 * `prisma db push` applies schema changes with no migration record, which is
 * how this project ended up without a migration history in the first place.
 * It stays available for fast local iteration and is blocked everywhere else.
 *
 * @param {string | undefined} url
 */
export function assertPushAllowed(url) {
  const target = classifyDatabaseTarget(url);
  if (target.kind === "local") return target;

  throw new Error(
    `'prisma db push' refuses to run: ${target.reason}.\n` +
      `  Target host: ${target.host ?? "unknown"}\n\n` +
      `  db push applies schema changes without recording a migration, which causes\n` +
      `  the drift this project has already had to recover from once.\n\n` +
      `  Use 'npm run db:migrate' locally, and 'prisma migrate deploy' for deployed\n` +
      `  databases. See docs/engineering/runbook.md.`
  );
}

/**
 * Compares actual row counts against what the seed itself creates, and returns
 * a human-readable description of every table holding more than it should.
 * An empty array means the database looks disposable.
 *
 * Pure, so the safety decision is testable without a database. The hostname
 * checks above cannot see through a tunnel; this comparison can, because it
 * asks the database what it holds rather than where it lives.
 *
 * @param {Record<string, number>} counts   actual row counts, keyed by table
 * @param {Record<string, number>} volumes  rows the seed creates, same keys
 * @returns {string[]}
 */
export function findExcessData(counts, volumes) {
  return Object.keys(volumes)
    .filter((table) => (counts[table] ?? 0) > volumes[table])
    .map((table) => `${counts[table]} ${table} (seed creates ${volumes[table]})`);
}

/**
 * Switches that bypass a guard. Honoured only when set in the shell for one
 * command, never from .env or .env.local: a value left in a file would
 * silently disarm the guard for every later command (flags O8).
 */
export const SHELL_ONLY_VARS = ["ALLOW_DESTRUCTIVE_SEED", "ALLOW_DEPLOYED_DB"];

/**
 * The environment scripts/with-env.mjs runs a command with. The shell wins
 * over the files: before, .env.local overrode it, and since .env.local points
 * at production on the owner's machine, `DATABASE_URL=<local> npm run db:...`
 * still reached production (flags O8).
 *
 * @param {Record<string, string>} fileEnv   .env then .env.local, merged
 * @param {Record<string, string | undefined>} shellEnv  process.env
 */
export function mergeEnv(fileEnv, shellEnv) {
  const files = { ...fileEnv };
  for (const name of SHELL_ONLY_VARS) delete files[name];
  return { ...files, ...shellEnv };
}

/**
 * Refuses a script whose database target is not allowed for what it does.
 *
 *   local-only  never a deployed database, no override (`prisma migrate dev`
 *               offers to reset the database it is pointed at).
 *   writes      a deployed database only with ALLOW_DEPLOYED_DB=1 set in the
 *               shell for that one command.
 *
 * Checks DATABASE_URL and DIRECT_URL, since Prisma uses either. Returns the
 * deployed hosts it let through, for a warning.
 *
 * @param {"local-only" | "writes"} mode
 * @param {Record<string, string | undefined>} env  the merged environment
 * @returns {string[]}
 */
export function assertScriptTargetAllowed(mode, env) {
  const deployed = ["DATABASE_URL", "DIRECT_URL"]
    .filter((name) => env[name])
    .map((name) => ({ name, target: classifyDatabaseTarget(env[name]) }))
    .filter(({ target }) => !isEphemeral(target));
  if (deployed.length === 0) return [];

  const hosts = deployed.map(({ name, target }) => `${name} -> ${target.host ?? "unparseable"}`).join(", ");
  if (mode === "writes" && env.ALLOW_DEPLOYED_DB === "1")
    return [...new Set(deployed.map(({ target }) => target.host ?? "?"))];

  throw new Error(
    mode === "local-only"
      ? `Refusing: this command only runs against a local database (${hosts}).\n` +
          `  It can reset the database it is pointed at. Point DATABASE_URL and\n` +
          `  DIRECT_URL at a local database in the shell, which now overrides .env.local.`
      : `Refusing: this command writes to a deployed database (${hosts}).\n` +
          `  If that is intended, run it again with ALLOW_DEPLOYED_DB=1 set in the shell\n` +
          `  for this one command (an env-file value is ignored). Migrations go through\n` +
          `  the reviewed migrate-production workflow, not this.`
  );
}
