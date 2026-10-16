import { afterEach, describe, expect, it } from "vitest";
import {
  assertDestructiveAllowed,
  assertPushAllowed,
  assertScriptTargetAllowed,
  classifyDatabaseTarget,
  findExcessData,
  isEphemeral,
  mergeEnv
} from "../scripts/db-target.mjs";

/**
 * These guards stand between `npm run db:seed` and every client record in
 * production: PAN, phone, AUM, KYC status, meeting notes. They are the one
 * piece of this codebase whose failure is unrecoverable, so they are tested
 * for the ways they could wrongly say yes, not just the happy path.
 */

const SUPABASE = "postgresql://u:p@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://u:p@localhost:5432/advisory_os";
const COMPOSE = "postgresql://u:p@postgres:5432/advisory_os";

const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

afterEach(() => {
  delete process.env.CI;
  delete process.env.ALLOW_DESTRUCTIVE_SEED;
});

describe("classifyDatabaseTarget", () => {
  it("treats a managed host as deployed", () => {
    expect(classifyDatabaseTarget(SUPABASE).kind).toBe("deployed");
  });

  it("treats localhost and compose service names as local", () => {
    expect(classifyDatabaseTarget(LOCAL).kind).toBe("local");
    expect(classifyDatabaseTarget(COMPOSE).kind).toBe("local");
  });

  it("does NOT let CI launder a remote host into something disposable", () => {
    // Regression: an earlier version returned "ci" for any host when CI was
    // set, so a workflow pointed at Supabase was allowed to wipe it.
    withEnv({ CI: "true" }, () => {
      const target = classifyDatabaseTarget(SUPABASE);
      expect(target.kind).toBe("deployed");
      expect(isEphemeral(target)).toBe(false);
    });
  });

  it("reports ci only for a local host", () => {
    withEnv({ CI: "true" }, () => {
      expect(classifyDatabaseTarget(LOCAL).kind).toBe("ci");
    });
  });

  it("fails closed on a missing or unparseable connection string", () => {
    expect(isEphemeral(classifyDatabaseTarget(undefined))).toBe(false);
    expect(isEphemeral(classifyDatabaseTarget("not a url"))).toBe(false);
  });
});

describe("assertDestructiveAllowed", () => {
  it("refuses a deployed database", () => {
    expect(() => assertDestructiveAllowed(SUPABASE)).toThrow(/refuses to run/);
  });

  it("refuses a deployed database even in CI", () => {
    withEnv({ CI: "true" }, () => {
      expect(() => assertDestructiveAllowed(SUPABASE)).toThrow(/refuses to run/);
    });
  });

  it("allows a local database", () => {
    expect(() => assertDestructiveAllowed(LOCAL)).not.toThrow();
  });

  it("allows a deployed database only with the explicit override", () => {
    withEnv({ ALLOW_DESTRUCTIVE_SEED: "1" }, () => {
      expect(() => assertDestructiveAllowed(SUPABASE)).not.toThrow();
    });
  });

  it("does not accept a truthy-but-wrong override value", () => {
    withEnv({ ALLOW_DESTRUCTIVE_SEED: "true" }, () => {
      expect(() => assertDestructiveAllowed(SUPABASE)).toThrow(/refuses to run/);
    });
  });
});

describe("assertPushAllowed", () => {
  it("refuses anything that is not local, with no override", () => {
    expect(() => assertPushAllowed(SUPABASE)).toThrow(/refuses to run/);
    withEnv({ ALLOW_DESTRUCTIVE_SEED: "1" }, () => {
      expect(() => assertPushAllowed(SUPABASE)).toThrow(/refuses to run/);
    });
  });

  it("refuses even in CI, where db push has no legitimate use", () => {
    withEnv({ CI: "true" }, () => {
      expect(() => assertPushAllowed(LOCAL)).toThrow(/refuses to run/);
    });
  });
});

describe("findExcessData", () => {
  const volumes = { users: 2, clients: 3, prospects: 3 };

  it("treats an empty database as disposable", () => {
    expect(findExcessData({ users: 0, clients: 0, prospects: 0 }, volumes)).toEqual([]);
  });

  it("treats an already-seeded database as disposable", () => {
    expect(findExcessData({ users: 2, clients: 3, prospects: 3 }, volumes)).toEqual([]);
  });

  it("flags a database holding real data behind a tunnel", () => {
    // The whole point: the host said localhost, the contents say production.
    const excess = findExcessData({ users: 14, clients: 862, prospects: 310 }, volumes);
    expect(excess).toHaveLength(3);
    expect(excess.join(" ")).toContain("862 clients");
  });

  it("flags a single over-count, not just wholesale differences", () => {
    expect(findExcessData({ users: 2, clients: 4, prospects: 3 }, volumes)).toEqual(["4 clients (seed creates 3)"]);
  });

  it("treats a missing count as zero rather than crashing", () => {
    expect(findExcessData({}, volumes)).toEqual([]);
  });
});

describe("mergeEnv (flags O8)", () => {
  it("lets the shell override the env files", () => {
    // Before: .env.local (production on the owner's machine) beat the shell.
    expect(mergeEnv({ DATABASE_URL: SUPABASE }, { DATABASE_URL: LOCAL }).DATABASE_URL).toBe(LOCAL);
  });

  it("falls back to the files for anything the shell does not set", () => {
    expect(mergeEnv({ NEXTAUTH_URL: "http://x" }, {}).NEXTAUTH_URL).toBe("http://x");
  });

  it("ignores guard overrides that come from a file", () => {
    const env = mergeEnv({ ALLOW_DESTRUCTIVE_SEED: "1", ALLOW_DEPLOYED_DB: "1" }, {});
    expect(env.ALLOW_DESTRUCTIVE_SEED).toBeUndefined();
    expect(env.ALLOW_DEPLOYED_DB).toBeUndefined();
  });

  it("keeps guard overrides set in the shell", () => {
    expect(mergeEnv({}, { ALLOW_DEPLOYED_DB: "1" }).ALLOW_DEPLOYED_DB).toBe("1");
  });
});

describe("assertScriptTargetAllowed", () => {
  it("lets either mode run against a local database", () => {
    expect(assertScriptTargetAllowed("local-only", { DATABASE_URL: LOCAL, DIRECT_URL: COMPOSE })).toEqual([]);
    expect(assertScriptTargetAllowed("writes", { DATABASE_URL: LOCAL })).toEqual([]);
  });

  it("refuses local-only commands on a deployed database, even with the override", () => {
    expect(() => assertScriptTargetAllowed("local-only", { DATABASE_URL: SUPABASE })).toThrow(
      /only runs against a local/
    );
    expect(() => assertScriptTargetAllowed("local-only", { DATABASE_URL: SUPABASE, ALLOW_DEPLOYED_DB: "1" })).toThrow(
      /only runs against a local/
    );
  });

  it("refuses writes to a deployed database unless the shell allows it", () => {
    expect(() => assertScriptTargetAllowed("writes", { DATABASE_URL: SUPABASE })).toThrow(/ALLOW_DEPLOYED_DB=1/);
    expect(assertScriptTargetAllowed("writes", { DATABASE_URL: SUPABASE, ALLOW_DEPLOYED_DB: "1" })).toHaveLength(1);
  });

  it("checks DIRECT_URL too, since migrations use it", () => {
    expect(() => assertScriptTargetAllowed("writes", { DATABASE_URL: LOCAL, DIRECT_URL: SUPABASE })).toThrow(
      /DIRECT_URL/
    );
  });

  it("refuses an unparseable URL rather than guessing it is local", () => {
    expect(() => assertScriptTargetAllowed("writes", { DATABASE_URL: "not a url" })).toThrow();
  });
});
