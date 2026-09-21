# 3. Key destructive-operation guards to a documented environment matrix

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

`prisma/seed.ts` begins with `clear()`, which deletes every row in all 13
tables. It is run through `npm run db:seed`, which loads whatever
`DATABASE_URL` happens to be in `.env.local`. During the login work that became
commit `43f7e37`, that file legitimately pointed at production.

One mis-set variable was the entire distance between a routine reseed and
destroying real client records — PAN, AUM, KYC status, meeting notes — with
recovery depending on a backup nobody had tested.

An ad-hoc `if (process.env.NODE_ENV === "production")` check would not help:
`NODE_ENV` describes the build, not the database being pointed at.

## Decision

Classify the *target database*, by hostname, in `scripts/db-target.mjs`:
`local`, `ci`, `deployed` or `unknown`. Guards key off that classification, and
the classification is documented as an environment matrix in
`docs/engineering/runbook.md`.

- `assertDestructiveAllowed()` guards the seed. Ephemeral targets only.
  Override with `ALLOW_DESTRUCTIVE_SEED=1`, which warns loudly and proceeds.
- `assertPushAllowed()` guards `db push`. Local only, no override.

An unparseable or absent connection string classifies as `unknown` and is
treated as unsafe. The guard fails closed.

## Two independent checks, because one is not enough

Hostname classification has a hole that cannot be closed from the hostname:
`ssh -L`, `cloud-sql-proxy` and `kubectl port-forward` all present a
production database as `localhost`. Tunnelling to production is routine, so
this is a likely case, not an exotic one.

The second check therefore asks the *database* rather than the *address*:
`findExcessData()` compares actual row counts against what the seed itself
creates (2 users, 3 clients, 3 prospects). A disposable database is empty or
holds no more than that. Anything beyond it is somebody's real data, and a
tunnel does not disguise it.

Both checks share the single `ALLOW_DESTRUCTIVE_SEED=1` override, so a
deliberate reseed of a real database still takes exactly one decision.

Neither check is a substitute for not pointing `.env.local` at production.
They are there for the day someone does it anyway.

## Consequences

- The matrix and `scripts/db-target.mjs` must change together. The runbook says
  so in both places.
- A deliberate production reseed is still possible, but it cannot happen by
  accident — it requires setting a variable whose name states what it does.
- `SEED_VOLUMES` in `prisma/seed.ts` must be updated whenever the seed's user,
  client or prospect counts change, or the row-count check will refuse to run
  against a legitimately seeded database. That is the intended failure
  direction: it fails closed and is fixed by editing one line.
- The helper is plain ESM so the npm scripts and `prisma/seed.ts` share one
  implementation. It carries a hand-written `scripts/db-target.d.mts` so
  TypeScript callers get real types. An earlier version used
  `@ts-expect-error` instead; that silently depended on how Prettier wrapped
  the import statement, and broke the moment the import grew long enough to
  split across lines. A safety-critical module should be typed, not suppressed.
- The guards are covered by `tests/db-target.test.ts`, including a regression
  test for the CI-laundering bug described below.

## A bug this decision already caught

The first implementation derived `kind` from CI *before* the host: `CI=true`
returned `"ci"` for any host, and `isEphemeral()` treats `ci` as disposable. A
workflow with `DATABASE_URL` pointed at Supabase would have been allowed to
wipe it — in the one context where nobody is watching the output.

Classification is now host-first; CI only refines the label for a host that is
already local. `tests/db-target.test.ts` pins this.
