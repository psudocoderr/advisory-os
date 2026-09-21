# Advisory OS

Internal operating system for a Mutual Fund Distributor practice. Three parts:

- **CRM** — prospects through to clients, with investment plans, portfolio reviews and meeting logs
- **Knowledge base** — a 30-day operational curriculum as linked SOPs, organised into five modules
- **Certification** — an adaptive test over that curriculum, scored with item response theory

Staff-only. End clients are records in the system, not users of it.

## Status

Working internal MVP, deployed on Vercel against Supabase Postgres.

**The certification is not ready to certify anyone.** The question bank shipped
with placeholder content: 12 questions per module against a target of 40, and
the seeded items were structurally degenerate in a way that made the test
passable without knowledge of the subject. The generator is fixed and the bank
is now validated, but real questions still have to be written. Run
`npm run questions:check` to see where it stands.

## Stack

Next.js 15 (App Router, React 19) · TypeScript · Tailwind · Prisma 5 ·
PostgreSQL · NextAuth v4 (credentials, JWT) · Vitest · Node 22

No UI framework — components are hand-built in `src/components/ui.tsx` against
the design tokens in `tailwind.config.ts`.

## Local setup

Requires Node 22 (`.nvmrc`) and Docker for the local database.

```bash
cp .env.example .env.local     # then fill it in, see below
docker compose up -d           # Postgres on :5432
npm install                    # runs prisma generate
npm run db:migrate             # apply migrations
npm run db:seed                # fixtures
npm run dev
```

`.env.local` needs, at minimum:

- `DATABASE_URL` and `DIRECT_URL` — both pointing at the local Postgres for
  development. The two differ in deployed environments: `DATABASE_URL` is the
  pooled connection the app uses, `DIRECT_URL` the session-mode one that
  migrations need.
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `SEED_ADMIN_PASSWORD` and `SEED_ADVISOR_PASSWORD` — **no defaults**. The seed
  refuses to run without them rather than inventing a password, because a
  default password published in a repository becomes a live credential on any
  environment seeded with the variable unset.

Seeded logins are `admin@advisory.local` and `advisor@advisory.local`, with
whatever passwords you set. They are development conveniences; a deployed
instance should use `npm run bootstrap:admin`.

## Commands

```bash
npm run dev              # development server
npm run build            # production build
npm run test             # vitest
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm run format           # prettier

npm run db:migrate       # create and apply a migration (local only)
npm run db:deploy        # apply migrations (deployed environments)
npm run db:status        # migration state of the target database
npm run db:drift         # does the database match schema.prisma?
npm run db:seed          # reset to fixtures (refuses deployed databases)
npm run db:snapshot      # capture current contents to backups/
npm run db:reseed        # snapshot, then seed
npm run db:studio        # Prisma Studio

npm run questions:check     # audit the certification question bank
npm run questions:template  # CSV template for authoring questions
npm run questions:import    # validate a CSV; --apply to load it

npm run bootstrap:admin  # create or reset an admin account
```

## Safety rails

Several commands will refuse to run, by design. They are not broken.

| What | Why |
|---|---|
| `db:seed` refuses deployed databases | It deletes every row first. It also checks the row counts, so a tunnel that makes production look like `localhost` does not get past it. Override with `ALLOW_DESTRUCTIVE_SEED=1`. |
| `db:push` refuses anything but local | It changes the schema without recording a migration, which is how this project once ended up with a production database and no migration history. |
| `db:snapshot` omits row contents on deployed databases | A full dump would put client PAN, phone numbers and AUM into a plaintext file. Counts and test outcomes only. |
| `questions:import` rejects a skewed bank | A bank where one answer key dominates, or where distractors repeat, is passable without reading the questions. That is not hypothetical — it is what shipped. |
| `bootstrap:admin` rejects short or published passwords | The account it creates bypasses row scoping and reads every client record. |

## How certification works

A candidate starts a module. Each answer updates an ability estimate (theta)
and its standard error, using a 3-parameter logistic IRT model in
`src/lib/irt.ts`. The next question is whichever remaining item is most
informative at the current estimate.

A session ends when one of three things happens, all handled in
`src/lib/certify-session.ts`:

- **the stop rule** — enough questions answered and the estimate is confident enough
- **the bank runs out** — no unseen questions remain
- **the clock runs out** — 20 minutes, enforced on the server from `startedAt`

Timing out with too few answers is recorded as abandonment, not failure, so
walking away does not trigger the retry cooldown.

The exam surface requests fullscreen and records when the candidate leaves it:
fullscreen exit, tab switch, window blur, copy, paste, right-click. These are
**records, not controls** — no web API prevents a screenshot, a phone camera or
a second device, and fullscreen can always be exited. The value is the audit
trail, not prevention.

## Layout

```
prisma/           schema, migrations, seed fixtures
scripts/          operational tooling (guards, snapshot, question bank, admin)
src/app/(app)/    authenticated pages; auth is enforced in AppShell, not middleware
src/app/api/      auth, health, certification endpoints
src/components/   hand-built UI, exam shell
src/lib/          domain logic: auth, IRT, session lifecycle, question bank
docs/engineering/ runbook and architecture decision records (committed)
```

Most of `docs/` is gitignored as internal working material; `docs/engineering/`
and `docs/legal/` are the committed exceptions.

## Deployment

Vercel, from `main`. Set the project's Node version to 22 — `.npmrc` sets
`engine-strict=true`, so a mismatch fails the install rather than silently
running on the wrong runtime.

Migrations are **not** part of the deploy. They run through the
`migrate-production` GitHub Actions workflow, because a schema change against
real client data should be a deliberate act rather than a side effect of a
push. The workflow targets a GitHub environment named `production`; adding
required reviewers to that environment, in repository settings, is what
actually makes it a gate. Schema changes follow expand/migrate/contract — see
the runbook.

CI runs lint, types, formatting, tests, a production build, and a job that
applies every migration to an empty database and asserts the result still
matches `schema.prisma`.

## Documentation

- [`docs/engineering/runbook.md`](docs/engineering/runbook.md) — environment
  matrix, migration procedures, admin recovery, secret rotation, incident
  response and its statutory clocks
- [`docs/engineering/adr/`](docs/engineering/adr/) — why migrations were
  baselined onto a `db push` database, why the destructive-operation guards are
  keyed to environment, why decisions are recorded at all
