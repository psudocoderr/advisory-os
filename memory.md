# Project Memory: Advisory OS

## Product Overview

**Advisory OS** is a Next.js 15 internal operating system for Mutual Fund Distributor (MFD) practices and advisory firms. It combines:

1. **CRM**: Prospects pipeline, client portfolio management, investment plan proposals, portfolio reviews, meeting logs, and admin user controls.
2. **30-Day MFD Training & Knowledge Portal**: Structured 30-day curriculum (Week 1–4, Days 1–30) covering regulatory compliance, identity checks, client onboarding, transaction platforms (BSE StAR MF, NSE NMF II, CAMS, KFintech), mandates, and portfolio rebalancing.
3. **Adaptive Certification Engine**: IRT-style EAP scoring across Modules M1–M5, question banks, SOP remediation links, credential tracking, and admin performance metrics.

---

## Tech Stack & Architecture

- **App Framework**: Next.js 15 App Router with React 19.
- **Authentication**: NextAuth credentials provider with JWT session management.
- **Database**: Cloud/Local PostgreSQL through Prisma ORM.
- **Styling**: Tailwind CSS with custom design tokens in `src/components/ui.tsx`.
- **Seed Script**: `prisma/seed.ts` populating 30-day MFD SOPs, demo CRM data, and M1–M5 question banks.
- **Deployment**: Vercel Serverless with hosted PostgreSQL (Neon / Supabase).

---

## 30-Day MFD Training Roadmap

- **Week 1 (Module M1 - Days 1–7)**: AMFI/SEBI regulatory framework, NISM Series V-A, ARN/EUIN, PAN/C-KYC, KRA fetches, and identity proof protocols.
- **Week 2 (Module M2 - Days 8–14)**: Account setup, bank penny-drop, e-NACH mandates, Risk Profiling, Asset Allocation, and nomination rules.
- **Week 3 (Module M3 - Days 15–21)**: BSE StAR MF / NSE NMF II order routing, CAMS/KFintech operations, SIP/ELSS cut-off timing, and transaction reconciliation.
- **Week 4 (Module M4 - Days 22–28)**: Portfolio XIRR computation, asset drift rebalancing, review logging, AUM sync, and practice auditability.
- **Master Practice (Module M5 - Days 29–30)**: Composite practice evaluation testing end-to-end scenario judgment across all 30 days.

---

## Core File Index

- `prd.md`: Product Requirements Document outlining CRM, Dashboard, and 30-Day MFD Training specs.
- `prisma/schema.prisma`: Data model for users, CRM entities, 30-day SOPs, IRT test sessions, and certifications.
- `prisma/seed.ts`: Seed script containing 30-day MFD SOP curriculum and M1–M5 question items.
- `src/app/(app)/knowledge/page.tsx`: 30-Day Training Pathway & Table of Contents view.
- `src/app/(app)/knowledge/[sopId]/page.tsx`: SOP detail view with step-by-step operational checklists and day navigation.
- `src/app/(app)/dashboard/page.tsx`: Executive dashboard with 30-Day Fresher Operational Readiness Tracker.
- `src/lib/irt.ts`: Adaptive scoring and question selection engine.
- `src/lib/auth.ts`: NextAuth configuration, session guards, and role scoping.

---

## Environment Variables

- `DATABASE_URL`: Cloud PostgreSQL connection string (Neon / Supabase).
- `NEXTAUTH_URL`: App URL (`http://localhost:3000` for local, `https://your-app.vercel.app` for production).
- `NEXTAUTH_SECRET`: Secret key for session encryption.
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`: Demo admin user credentials.
- `SEED_ADVISOR_EMAIL` / `SEED_ADVISOR_PASSWORD`: Demo advisor user credentials.
