# Project Memory

## Product

Advisory OS is a Next.js 15 internal startup MVP for an advisory firm. It combines:

- CRM: prospects, clients, meetings, plans, reviews, dashboard, admin user controls.
- Knowledge portal: SOP categories and SOP detail pages.
- Certification: adaptive module tests using IRT-style EAP scoring, question banks, remediation links, credential expiry, and admin item-performance reporting.

## Stack

- App framework: Next.js App Router with React 19.
- Auth: NextAuth credentials provider with JWT sessions.
- Database: PostgreSQL through Prisma.
- Styling: Tailwind CSS and local UI primitives in `src/components/ui.tsx`.
- Seed data: `prisma/seed.ts`.
- Local database: `docker-compose.yml` starts Postgres on `localhost:5432`.

## Current Feature State

- CRM sections are functional:
  - Prospects: create, search, stage filter, stage update, meeting log, convert/onboard prospect into a client.
  - Clients: create, search, KYC filter, masked PAN/phone list, KYC update, meeting log.
  - Plans: create, search, status filter, status update with sent/accepted date handling.
  - Reviews: create, search, due-next-30-days filter, review AUM syncs back to the client.
  - Dashboard: scoped metrics, pipeline, recent activity, follow-ups, upcoming reviews, active certification status.
- Certification sections are functional:
  - Modules M1-M5 are available.
  - M5 full advisory module is seeded with SOP and question bank.
  - Starting a test resumes the latest in-progress attempt instead of creating duplicates.
  - Answers are scored server-side; the client never receives the correct key.
  - Passing issues or updates an active certification for one year.
  - Failing returns linked SOP remediation.
- Admin is functional:
  - Admin-only route guard.
  - Team certification matrix including M1-M5.
  - Create users and activate/deactivate users.
  - Create certification questions linked to SOPs.
  - Expiry alerts, attempt history, audit log, and item-performance report.
- Operational:
  - `/api/health` returns database reachability for deploy monitors.
  - App layout is `force-dynamic` so protected Prisma pages do not try to prerender without a database.
  - Login page wraps the `useSearchParams` client form in Suspense for Next production builds.

## Important Files

- `prisma/schema.prisma`: data model.
- `prisma/seed.ts`: demo users, CRM data, SOPs, M1-M5 question banks.
- `src/lib/actions.ts`: server actions for CRM/admin workflows.
- `src/lib/irt.ts`: adaptive scoring and question selection.
- `src/lib/auth.ts`: NextAuth config, session guards, advisor/admin scoping.
- `src/app/api/certify/start/route.ts`: certification attempt start/resume.
- `src/app/api/certify/answer/route.ts`: answer submission, scoring, certification issue, remediation.
- `src/app/api/health/route.ts`: deploy health check.
- `scripts/with-env.mjs`: loads `.env` and `.env.local` for Prisma/seed scripts.

## Required Environment Variables

Minimum runtime:

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`

Seed-only:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `SEED_ADVISOR_EMAIL`
- `SEED_ADVISOR_PASSWORD`

Hardening hooks are present in `.env.example` but not required for the MVP runtime:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_DOMAIN`
- `REDIS_URL`
- `DB_ENCRYPTION_KEY`
- `IP_ALLOWLIST`

## Deploy Notes

- This is a Next.js app. It does not need a hand-written `index.html`; Next generates HTML at build/request time from `src/app/page.tsx` and route files.
- For production, use a managed PostgreSQL database, not Docker Compose.
- Run `npm ci`, `npm run db:generate`, `npm run db:push` or a proper Prisma migration workflow, optionally `npm run db:seed`, then `npm run build`, then `npm run start`.
- Use `/api/health` as the uptime/health endpoint after deploy.

## Verification Status

- `npm run typecheck` passed after feature additions.
- `npm run lint` passed before the env helper conversion; rerun after final edits.
- Production build previously compiled successfully once outside the sandbox, but local final build verification depends on Node/user-directory access and a reachable database service.
- Docker Desktop was not running in this environment, so local DB-backed browser verification could not be completed here.
