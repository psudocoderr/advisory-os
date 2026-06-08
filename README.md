# Advisory OS

Functional MVP for an internal advisory operating system: CRM, knowledge portal, and adaptive certification.

## Local Setup

1. Copy `.env.example` to `.env.local` and set `NEXTAUTH_SECRET`.
2. Start PostgreSQL:

```bash
docker compose up -d
```

3. Install and prepare the app:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

## Seeded Users

- Admin: `admin@advisory.local`
- Advisor: `advisor@advisory.local`

Passwords come from `.env.local`, or the defaults shown in `.env.example`.

## MVP Boundaries

This release keeps R2, Redis, Cloudflare WAF/CDN, refresh-token rotation, column-level encryption, and automated IRT recalibration as hardening hooks rather than mandatory runtime dependencies.
