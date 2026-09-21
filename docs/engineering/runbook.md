# Advisory OS — Operations Runbook

Operational procedures for running, changing and recovering Advisory OS.
Companion documents: [`system-design.md`](./system-design.md) for architecture
and scaling, [`adr/`](./adr/) for the reasoning behind specific decisions.

> Most of `docs/` is gitignored as confidential internal material. This file
> and its siblings under `docs/engineering/` and `docs/legal/` are deliberately
> committed so they are reviewable in pull requests. See `.gitignore`.

---

## 1. Environment matrix

Every guardrail in this codebase keys off this table. If you change a row here,
change `scripts/db-target.mjs` to match.

| | Local dev | CI | Preview | Production |
|---|---|---|---|---|
| **Database** | Docker Compose Postgres (`docker-compose.yml`) | ephemeral `postgres:16` service container | separate Supabase project, **synthetic data only** | Supabase — real PAN, phone, AUM |
| **Contains real personal data** | no | no | **no, ever** | yes |
| **Destructive seed** (`db:seed`) | allowed | allowed | allowed | **refused** — override only |
| **`prisma db push`** | allowed | n/a | refused | refused |
| **Schema changes applied by** | `migrate dev` | `migrate deploy` | `migrate deploy` | `migrate deploy`, reviewed |
| **Search engine indexing** | n/a | n/a | `noindex` on every route | legal routes only |
| **Secrets live in** | `.env.local` | GitHub Actions dummies | Vercel preview env | Vercel production env |

### Why preview must never point at production

Production holds PAN (a government identifier), client phone numbers, AUM
figures and free-text advisor notes. A preview deployment is a public URL with
a shifting, low-attention security posture. Pointing one at production data
would expose all of it, and preview URLs are indexable unless explicitly
suppressed — which is why previews carry `X-Robots-Tag: noindex`.

### How the guards work

`scripts/db-target.mjs` classifies a connection string as `local`, `ci`,
`deployed` or `unknown` by hostname, and exports two assertions:

- `assertDestructiveAllowed()` — called at the top of `prisma/seed.ts`, before
  `clear()` deletes every row. Refuses anything not ephemeral. Override with
  `ALLOW_DESTRUCTIVE_SEED=1`, which prints a loud warning and proceeds.
- `assertPushAllowed()` — called by `scripts/guard-push.mjs`, which backs
  `npm run db:push`. Local only.

An unparseable or absent connection string classifies as `unknown`, which is
treated as unsafe. Failing closed is the point.

**Neither guard can see through a tunnel.** `ssh -L`, `cloud-sql-proxy` and
`kubectl port-forward` make a production database look like `localhost`. That
is why the seed runs a second, independent check that inspects the database
itself: if it holds more rows than the seed creates, it refuses regardless of
what the hostname said. Both checks share the one override.

If you change how many users, clients or prospects the seed creates, update
`SEED_VOLUMES` in `prisma/seed.ts` to match — otherwise the seed will refuse to
run against a database it seeded itself.

---

## 2. Database changes

### The rule

**Local uses `migrate dev`. Everything deployed uses `migrate deploy`.**
`db push` is for local iteration only. It applies schema changes without
recording a migration, which is exactly how this project ended up with a
production database and no migration history.

`migrate dev` needs a throwaway "shadow" database to verify a migration before
applying it. Against the local Docker Compose Postgres it creates and drops one
automatically, so no configuration is needed. Do not add `shadowDatabaseUrl` to
`prisma/schema.prisma` to solve this: every `env()` in the datasource block is
resolved eagerly by *every* prisma command, including `prisma validate`, so a
third variable would have to be set in CI and production — which never run
`migrate dev` at all.

### Expand / migrate / contract

Vercel deploys on push to `main` in parallel with the migration workflow, so
for a window the old code runs against the new schema or the reverse. Every
schema change therefore ships in three steps, and the destructive one is always
a separate, later release:

1. **Expand** — an additive migration (new table, new nullable column),
   deployed *before* the code that uses it. Old code ignores it.
2. **Migrate** — the code that writes and reads the new shape, plus any
   backfill. Both shapes are valid during this window.
3. **Contract** — a *later* release drops the old column.

Never drop a column in the same release that stops writing to it.

### Migration checklist

- [ ] `npm run db:migrate` locally against the Docker Compose database
- [ ] Migration file committed under `prisma/migrations/`
- [ ] Expand/contract respected — is anything dropped in this release?
- [ ] `npm run db:seed` still succeeds against a fresh local database
- [ ] If personal data was added: retention schedule and privacy policy updated

---

## 3. Baselining migrations onto a `db push` database

One-time procedure, required because production predates any migration
history. **Stop at the first failure — do not improvise past it.**

1. **Take a Supabase backup or PITR checkpoint, and confirm it restores.**
   Not "confirm it exists". Confirm it restores.

2. **Detect drift before touching anything:**
   ```bash
   npm run db:drift
   ```
   Exit 0 means the database matches `prisma/schema.prisma` and is safe to
   baseline. Exit 2 means drift: **stop.** Read the emitted SQL, decide whether
   the database or the schema file is correct, and reconcile deliberately.
   Baselining over drift records a migration describing a schema the database
   does not have, and every later migration inherits that lie.

3. **Generate the baseline:**
   ```bash
   mkdir -p prisma/migrations/0_init
   prisma migrate diff --from-empty \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/0_init/migration.sql
   ```

4. **Mark it applied on every existing database** — production, local, and the
   preview project. Each one needs this; an un-baselined database will try to
   run `0_init` and fail on tables that already exist.
   ```bash
   prisma migrate resolve --applied 0_init
   ```

5. **Verify:** re-run `npm run db:drift` (expect exit 0), then
   `npm run db:status` (expect "up to date").

---

## 4. Incident response

### CERT-In: 6 hours

The CERT-In Directions (April 2022) require reporting specified cyber
incidents to CERT-In **within 6 hours** of noticing them. This is the
shortest clock the practice is subject to and it starts on *noticing*, not on
confirming. Do not wait for a complete picture before reporting.

Also required: retention of ICT logs within India for **180 days**. The current
`audit_logs` retention of 3 years satisfies the duration; confirm the storage
region satisfies the locality requirement.

### Personal data breach

| Obligation | Clock | Who |
|---|---|---|
| CERT-In incident report | 6 hours from noticing | CERT-In |
| DPDP breach notification | without delay | Data Protection Board **and every affected data principal** |
| GDPR notification (if EU data involved) | 72 hours | lead supervisory authority |

DPDP has **no materiality threshold** — unlike GDPR, there is no "unlikely to
result in a risk" exemption to fall back on. Assume every personal data breach
is notifiable to both the Board and the affected individuals.

Steps: contain → preserve logs before anything rotates → assess which data
categories and how many principals → notify on the clocks above → record the
whole sequence in `AuditLog` and the incident log.

### Rights requests and takedowns

| Request | Acknowledge | Resolve |
|---|---|---|
| Grievance (IT Rules 2021) | 24 hours | 15 days |
| DPDP data principal request | promptly | as prescribed |
| GDPR data subject request | — | 30 days |
| Takedown notice (IT Rules) | 24 hours | 15 days |

Requests are tracked in the `DataRequest` and `TakedownRequest` tables with a
computed `dueAt`; the admin queue sorts by it. A statutory clock nobody looks
at is the failure mode, which is why overdue counts surface on the dashboard.

---

## 4a. Admin account recovery

The application has **no password reset**. `passwordHash` is written in exactly
two places -- `createUser()` in `src/lib/actions.ts` and `prisma/seed.ts` --
both at creation time. There is no email provider and no reset flow, so a
deployed instance with an unknown admin password has no recovery path through
the UI.

`scripts/bootstrap-admin.ts` is that path. It creates or resets **one** account
and touches nothing else.

```bash
ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD='<a real password>' \
ADMIN_NAME='Your Name' \
npm run bootstrap:admin
```

It is the deliberate opposite of the seed:

| | `prisma/seed.ts` | `scripts/bootstrap-admin.ts` |
|---|---|---|
| Scope | deletes every row, inserts fixtures | one user row plus an audit entry |
| Deployed databases | refuses | runs against them on purpose |
| Use when | setting up local or CI | recovering or rotating a deployed admin |

**Never run the seed to fix a login.** It calls `clear()` first. On a database
with real records that is unrecoverable without a backup restore.

**Setting `SEED_ADMIN_PASSWORD` in Vercel does nothing.** The build is
`prisma generate && next build`; it never seeds. Those variables are read only
at the moment the seed runs, from whichever machine runs it.

**After any password reset, rotate `NEXTAUTH_SECRET` too.** Sessions are
8-hour JWTs and `isActive`/`role` are read only at login, so a password change
does not end sessions already issued. Rotating the signing secret invalidates
every issued token at once. See `docs/flags.md` S1/S2.

---

## 4b. Rotating NEXTAUTH_SECRET

`NEXTAUTH_SECRET` signs the session JWTs. Changing it invalidates **every**
issued token at once, so everyone is logged out immediately.

That is the only way to end sessions on demand. Sessions are stateless JWTs
with an 8-hour lifetime, and `isActive`/`role` are read only at login
(`src/lib/auth.ts`), so deactivating a user, changing a password or demoting
someone does **not** end a session already in progress. Rotating the secret
does.

Rotate when: a credential was exposed, someone leaves, a role is revoked and
the change must take effect now, or the secret itself may have leaked.

```bash
# 1. Generate a new secret
openssl rand -base64 32
```

Then set it in Vercel, either in the dashboard under
Settings -> Environment Variables -> NEXTAUTH_SECRET -> Edit, or by CLI:

```bash
# 2. Replace the production value
vercel env rm NEXTAUTH_SECRET production -y
echo "<the new secret>" | vercel env add NEXTAUTH_SECRET production

# 3. Redeploy. Environment changes do not apply to a running deployment.
vercel --prod
```

**Step 3 is not optional.** An environment variable change has no effect until
the next deployment, so a rotation that stops at step 2 has changed nothing.

Afterwards: everyone signs in again, including you. Use a different secret
locally in `.env.local` — there is no reason for local and production to share
a signing key.

---

## 5. Routine operations

```bash
npm run dev              # local development server
npm run db:migrate       # create + apply a migration locally
npm run db:seed          # reset and reseed (local/CI only)
npm run db:status        # migration state of the target database
npm run db:drift         # does the database match schema.prisma?
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm run format:check     # prettier
npm run test             # vitest
```

Health check: `GET /api/health` returns `{ ok, database }`, 503 when the
database is unreachable. Unauthenticated, and currently wired to no uptime
monitor — see `system-design.md`.

---

## 6. Deployment

**Before the toolchain pinning merges**, set the Vercel project's Node.js
version to 22.x. `.npmrc` sets `engine-strict=true` and `package.json` declares
`engines.node: >=22.0.0 <23`, so `npm ci` will fail the build outright on any
other major version. That is deliberate — a silent Node mismatch between local
and production is worse than a failed build — but it means the Vercel setting
has to be changed first, not after.

Vercel deploys from Git: pushes to `main` go to production, pull requests get
preview deployments. Migrations are **not** part of that deploy — they run
through the `migrate-production` GitHub Actions workflow, scoped to a
`production` environment with required reviewers.

Rollback: revert the Vercel deployment. Note that this rolls back *code only* —
a migration already applied stays applied, which is the whole reason for the
expand/contract discipline in §2.
