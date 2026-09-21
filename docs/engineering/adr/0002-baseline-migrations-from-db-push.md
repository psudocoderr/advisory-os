# 2. Baseline Prisma migrations onto a database built with `db push`

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

The production Supabase database was provisioned with `prisma db push`. No
migration history exists: `prisma/migrations/` was absent and
`_prisma_migrations` was never created.

This makes every schema change a gamble. There is no reviewable artefact for
what changed, no way to reproduce the schema from the repository, and no way to
apply a change to production except by pushing again and hoping the diff is
what was expected.

The scope expansion this project is undertaking adds several tables
(consent records, data requests, structured content sources, moderation state).
Doing that without migrations would compound the problem.

## Decision

Baseline the existing database:

1. Verify there is no drift between the database and `prisma/schema.prisma`
   (`npm run db:drift`, which wraps `prisma migrate diff --exit-code`).
2. Generate `prisma/migrations/0_init/migration.sql` from an empty schema.
3. `prisma migrate resolve --applied 0_init` on every existing database.

Then block `db push` against anything but a local database
(`scripts/guard-push.mjs`), so the drift cannot return.

**The drift check is not optional.** Baselining over undetected drift records a
migration describing a schema the database does not have; every subsequent
migration then builds on a false premise, and the failure surfaces much later
and much more confusingly.

## Consequences

- `prisma migrate resolve` must be run against *each* environment separately.
  An un-baselined database will try to run `0_init` and fail on existing tables.
- CI proves the invariant continuously: it applies every migration to an empty
  database and then asserts zero diff against `schema.prisma`. A hand-edited
  schema with no migration now fails the build.
- Production schema changes move to a reviewed GitHub Actions workflow rather
  than a local command.
