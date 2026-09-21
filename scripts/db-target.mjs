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
