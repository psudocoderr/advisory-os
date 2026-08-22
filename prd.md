# Product Requirements Document (PRD): Advisory OS

## 1. Vision & Executive Summary

**Advisory OS** is an integrated operating system designed for modern Mutual Fund Distributor (MFD) practices and advisory firms. It combines three core operational pillars:

1. **CRM & Client Lifecycle Engine**: Scoped tracking of prospects, KYC-verified client assets, investment plan proposals, portfolio reviews, and follow-up cadence.
2. **Dashboard & Operational Command Center**: Scoped metrics for advisors and practice admins, surfacing pipeline status, upcoming reviews, follow-up alerts, and team certification matrix.
3. **30-Day MFD Operational Excellence Training & Certification Module**: A first-principles, 30-day curriculum structured to convert freshers into operationally proficient MFD professionals, backed by Item Response Theory (IRT) adaptive certification testing.

---

## 2. Core Objectives & Philosophy

- **First-Principles Operational Excellence**: Focus on actionable standard operating procedures (SOPs), real-world MFD workflows (NISM V-A, EUIN/ARN, KRA/C-KYC, BSE StAR MF / NSE NMF II, CAMS/KFintech, e-NACH mandates), and auditability.
- **"Less is More" Interface**: Clean, clutter-free tabular UI with zero fluff. Every view directly supports operational execution and compliance.
- **Defensible Adaptive Certification**: Evaluate fresher mastery using 3-parameter IRT (Item Response Theory) with Expected A Posteriori (EAP) theta scoring, server-side grading, and targeted SOP remediation links.

---

## 3. The 30-Day MFD Operational Excellence Curriculum

The training program is organized into 4 sequential weeks (30 days total), culminating in a master advisory composite certification:

```
┌─────────────────────────────────────────────────────────────────────────┐
│              30-DAY MFD FRESHER TO OPERATIONAL EXCELLENCE               │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
     ┌──────────────────────┬────────┴─────────┬──────────────────────┐
     │                      │                  │                      │
┌────▼─────────────┐   ┌────▼─────────┐   ┌────▼─────────────┐   ┌────▼─────────────┐
│  WEEK 1 (M1)     │   │ WEEK 2 (M2)  │   │  WEEK 3 (M3)     │   │  WEEK 4 (M4)     │
│ Days 1–7         │   │ Days 8–14    │   │ Days 15–21       │   │ Days 22–28       │
│ Regulatory & KYC │   │ Onboarding   │   │ Transactions &   │   │ Portfolio Review │
│ Compliance       │   │ & Risk Check │   │ Platform Ops     │   │ & Rebalancing    │
└──────────────────┘   └──────────────┘   └──────────────────┘   └──────────────────┘
                                                                          │
                                                                 ┌────────▼─────────┐
                                                                 │  MASTER (M5)     │
                                                                 │ Days 29–30       │
                                                                 │ Composite Practice│
                                                                 │ Certification    │
                                                                 └──────────────────┘
```

### Module 1 (Days 1–7): Regulatory Framework & Identity Compliance
- **Day 1–2**: AMFI/SEBI Regulations, NISM Series V-A Certification, ARN registration, and EUIN tagging rules.
- **Day 3–4**: PAN validation, Income Tax portal name matching, and KRA/C-KYC (NDML, CVL, CAMS KRA) verification.
- **Day 5–7**: FATCA/CRS declarations, PEP status, and identity disparity remediation protocols (Proof Protocol).

### Module 2 (Days 8–14): Client Onboarding & Investor Readiness
- **Day 8–10**: Account classification (Individual, Joint, HUF, NRI), Bank account penny-drop verification, and e-Mandates.
- **Day 11–12**: Risk Profiling methodology (Conservative, Moderate, Aggressive) and Asset Allocation suitability.
- **Day 13–14**: Nominee registration rules, minor guardian mapping, and establishing the first 90-day review schedule.

### Module 3 (Days 15–21): Platform Operations & Transaction Execution
- **Day 15–17**: Order routing on BSE StAR MF and NSE NMF II (Lump sum, SIP, Switch, STP, SWP).
- **Day 18–19**: Registrar & Transfer Agent (CAMS & KFintech) processing, NACH/e-Mandate registration, and rejection management.
- **Day 20–21**: ELSS tax-saving cut-off management, NAV allotment timing (T+1 / T+2), and daily transaction reconciliation.

### Module 4 (Days 22–28): CRM Lifecycle, Portfolio Reviews & Rebalancing
- **Day 22–24**: Computing portfolio XIRR, evaluating asset allocation drift, and generating rebalancing recommendations.
- **Day 25–27**: Annual review preparation, meeting logging, client consent capture, and updating client AUM.
- **Day 28**: Practice auditability, compliance log review, and follow-up hygiene.

### Module 5 (Days 29–30): Master Advisory Certification
- Comprehensive composite evaluation testing end-to-end scenario judgment across all 30 days of training.

---

## 4. CRM Functional Requirements

1. **Prospects Management**:
   - Filter by stage (`LEAD`, `MEETING_HELD`, `PLAN_SENT`, `ONBOARDED`, `DROPPED`).
   - Log meeting notes, next follow-up dates, and source (`REFERRAL`, `WALK_IN`, `EVENT`, `ONLINE`).
   - Convert qualified prospects directly into Client records.
2. **Client Portfolio Records**:
   - Mask sensitive fields (PAN, Phone) in list views.
   - Filter by KYC status (`VERIFIED`, `PENDING`, `EXPIRED`).
   - Real-time client AUM update driven by Portfolio Reviews.
3. **Investment Proposals (Plans)**:
   - Create goal-aligned plans (`RETIREMENT`, `EDUCATION`, `WEALTH`, `TAX_SAVING`).
   - Track plan type (`SIP`, `LUMP_SUM`, `ELSS`, `MIXED`) and frequency (`MONTHLY`, `QUARTERLY`, `ONE_TIME`).
   - Status workflow (`DRAFT` -> `SENT` -> `ACCEPTED` -> `ACTIVE` -> `CLOSED`).
4. **Portfolio Reviews**:
   - Record review date, current AUM, XIRR returns, actions taken, and next review date.
   - Automatically sync current AUM back to the Client record.

---

## 5. Certification & Adaptive Testing Specifications

- **Scoring Engine**: Server-side 3-Parameter Logistic (3PL) Item Response Theory (IRT) scoring with EAP theta estimation.
- **Adaptive Selection**: Selects questions based on current user ability ($\theta$), balancing difficulty ($b$) and discrimination ($a$).
- **Certification Standard**: Ability estimate $\theta \ge 0.50$ with standard error $SE \le 0.45$ issues active certification valid for 1 year.
- **Remediation**: Failing attempts generate targeted links to specific 30-day SOP entries for immediate restudy.

---

## 6. Architecture & Tech Stack

- **Framework**: Next.js 15 (App Router, React 19).
- **Styling**: Vanilla CSS tokens with Tailwind utility classes.
- **Database & ORM**: PostgreSQL with Prisma ORM.
- **Auth**: NextAuth.js with Credentials provider and JWT session management.
- **Deployment**: Vercel Serverless Platform with Cloud PostgreSQL (Neon / Supabase).
