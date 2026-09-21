# Advisory OS — codebase guide

Written to be read start to finish once, then used as reference. It explains
what each part does, how a request travels through the system, and why things
are arranged the way they are.

If you only read one section, read **§2 — how a request works**. Almost
everything else follows from it.

---

## 1. The shape of the thing

Three modules over one database:

- **CRM** — prospects become clients, clients get investment plans and
  portfolio reviews, everything generates meeting logs
- **Knowledge base** — a 30-day curriculum as SOP entries, grouped into five
  modules (M1–M5)
- **Certification** — an adaptive test over that curriculum, scored with item
  response theory

Roughly 6,600 lines across 48 files. 14 Prisma models, 13 pages, 6 API
endpoints, 13 server actions.

```
src/app/          routing and pages (Next.js App Router)
src/components/   React components, both server and client
src/lib/          all domain logic — the part worth understanding
prisma/           schema, migrations, seed fixtures
scripts/          operational tooling that runs outside the app
```

**The rule that keeps this navigable:** pages fetch and render, `src/lib`
decides. If you are looking for *how something works*, it is in `src/lib`.
Pages are mostly plumbing.

---

## 2. How a request works

This is the "stack trace" for loading `/prospects`.

### 2.1 The call chain

```
browser GET /prospects
  │
  ├─ src/app/layout.tsx              RootLayout — <html>, <body>, <Providers>
  │    └─ src/components/providers.tsx   NextAuth SessionProvider (client)
  │
  ├─ src/app/(app)/layout.tsx        ProtectedLayout
  │    │  export const dynamic = "force-dynamic"   ← no caching, ever
  │    └─ src/components/app-shell.tsx  AppShell (async server component)
  │         └─ requireSession()          ← AUTH HAPPENS HERE
  │              └─ getServerSession(authOptions)
  │                   └─ reads the JWT cookie, verifies with NEXTAUTH_SECRET
  │              └─ if no session: redirect("/login")   ← throws, unwinds
  │
  └─ src/app/(app)/prospects/page.tsx   ProspectsPage (async server component)
       ├─ requireSession()               again — cheap, already decoded
       ├─ scopedUserFilter(session)      → {} for ADMIN, {assignedToId} otherwise
       ├─ prisma.prospect.findMany({ where: { ...filter, ...search } })
       │    └─ Prisma Client → pooled Postgres connection → SQL
       └─ renders <Card>, <StatusBadge>, <SubmitButton> from ui.tsx
            └─ forms point at server actions imported from lib/actions.ts
```

### 2.2 The three things to take from that

**Auth is in `AppShell`, not middleware.** There is no `middleware.ts`. Every
authenticated page is inside the `(app)` route group, whose layout renders
`AppShell`, which calls `requireSession()`. That is the single chokepoint.

Why not middleware? Prisma cannot run on Next's edge runtime, and auth here
needs the database. Keeping it in a React Server Component means it runs in
Node where Prisma works. See `docs/engineering/adr/`.

The consequence: **anything outside `(app)` is public.** That is how
`/login` works with no configuration. It is also why adding a public page is
just a matter of putting it in a different route group.

**`force-dynamic` disables all caching for the authed app.** Correct for
per-user data, wrong for the knowledge base, which is identical for everyone.
It also makes the ~26 `revalidatePath()` calls in `actions.ts` almost no-ops —
there is nothing cached to invalidate. Listed as B2 in `docs/flags.md`.

**`redirect()` works by throwing.** `requireSession()` calls Next's `redirect`,
which throws a special error Next catches upstream. So code after it never
runs, and you do not need an `if` around it. This surprises people debugging
control flow.

### 2.3 Writing data: two paths

**Server actions — used for everything in the CRM.**

```
<form action={createProspect}>       client
  └─ POST to the same route, handled by Next
       └─ createProspect(formData)   src/lib/actions.ts, "use server"
            ├─ requireSession()                    who is asking
            ├─ zod .parse(...)                     validate, throws on bad input
            ├─ prisma.prospect.create(...)         write
            ├─ log(...)                            AuditLog row
            └─ revalidatePath("/prospects")        tell Next to re-render
```

No API route, no fetch, no JSON. The form posts, the function runs on the
server, the page re-renders.

**API routes — used only for the adaptive test.** Four endpoints under
`src/app/api/certify/`. They exist because the test needs JSON round-trips
without a full page re-render: the client submits an answer and gets the next
question back.

The rule: **mutations are server actions unless you need a JSON response.**

---

## 3. `src/lib` — the part worth understanding

### 3.1 `auth.ts`

| Export | What it does |
|---|---|
| `authOptions` | NextAuth config. Credentials provider, bcrypt compare, JWT strategy, 8-hour sessions. |
| `requireSession()` | Returns the session or redirects to `/login`. Call at the top of every protected page. |
| `requireAdmin()` | As above, then redirects to `/dashboard` unless role is ADMIN. |
| `scopedUserFilter(session)` | **The whole of row-level authorisation.** |

`scopedUserFilter` is four lines and carries enormous weight:

```ts
return session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id };
```

Spread into a Prisma `where`, it restricts an advisor to their own records. For
ADMIN it returns `{}` — an unscoped query — which is intentional, because the
practice owner needs team-wide visibility.

**If you write a query over user-owned data and forget to spread this, you have
leaked one advisor's clients to another.** Silently, with no error. That is why
it has its own test file.

**Known flaw (S1/S2 in `flags.md`):** `isActive` and `role` are read *only* at
login, inside `authorize()`. The `jwt` and `session` callbacks never touch the
database. So deactivating a user or demoting an admin does not take effect
until their 8-hour token expires. Rotating `NEXTAUTH_SECRET` is the only way
to end sessions immediately.

### 3.2 `irt.ts` — the certification maths

The most interesting file in the repo, and the smallest.

**Item response theory** models the probability that a person of ability
`theta` answers an item correctly, given three item parameters:

- `difficulty` (b) — where on the ability scale the item bites, about −2 to +2
- `discrimination` (a) — how sharply it separates ability, around 1.0
- `guessing` (c) — chance of a blind hit, 0.25 for four options

```
probability(theta, item) = c + (1 - c) / (1 + e^(-1.702 · a · (theta - b)))
```

That is the **3-parameter logistic model**. The `1.702` converts the logistic
curve to approximate the normal ogive — a historical convention, not magic.

| Function | Purpose |
|---|---|
| `probability(theta, q)` | Chance this person answers this item correctly |
| `information(theta, q)` | How much this item tells you at this ability. Peaks near the item's difficulty. |
| `estimateEap(responses, bank)` | Current ability estimate and its uncertainty |
| `selectNextQuestion(theta, bank, used)` | The unseen item with the most information at `theta` |
| `shouldStop(answered, se)` | Whether the test has learned enough |
| `certificationLevel(theta)` | Maps ability to a label |
| `deadlineFor` / `isExpired` | The 20-minute time limit |

**`estimateEap` in plain terms.** EAP means *expected a posteriori*. It walks a
grid of possible abilities from −4 to +4 in steps of 0.1. For each candidate
ability it asks: "if this were the true ability, how likely is the pattern of
answers we actually saw?" It multiplies that by a prior (a normal bell curve,
because extreme abilities are rare), then takes the weighted average. The
spread of that distribution is the standard error.

So `theta` is the best guess and `se` is how sure you are. `se` starts at 99
(know nothing) and shrinks as answers accumulate.

**Why adaptive?** Asking an expert easy questions teaches you nothing.
`selectNextQuestion` picks whatever item is most *informative* at the current
estimate, so the test converges faster and with fewer questions.

**This is why the question bank matters so much.** The maths only works if the
item parameters are meaningful. The seeded bank had every correct answer at
option A, which made every response pattern identical and every difficulty
parameter noise. See D0 in `flags.md`.

### 3.3 `certify-session.ts` — ending a test

A session leaves `IN_PROGRESS` in exactly one place: `finalizeSession()`. That
is deliberate — three different things can end a test, and they must all issue
certification, write the audit entry and build remediation identically.

```
FinishReason
  STOP_RULE        enough answers, estimate confident enough
  BANK_EXHAUSTED   no unseen questions remain
  TIMED_OUT        20 minutes elapsed
```

Two subtleties worth knowing:

**It is idempotent.** If the session is already finished it reports the stored
outcome instead of certifying again. A timeout racing a final answer would
otherwise issue two certifications.

**Timing out with fewer than `minQuestions` answers is ABANDONED, not FAILED.**
The retry cooldown query only matches `FAILED`, so abandonment is excluded from
it automatically. Without this, walking away from a test locked you out of the
module for 24 hours.

### 3.4 `question-bank.ts` — validation

Two functions with very different jobs:

- `validateQuestion()` — one question in isolation. Four distinct options, a
  valid key, parameters in range, an SOP link, an explanation.
- `validateBank()` — **the whole bank together.** Answer-key skew, distractor
  reuse, duplicate stems, difficulty spread, module size.

The second exists because the defect that shipped was invisible per-question:
every individual item was well formed. Only in aggregate did it become obvious
that every answer was A and the wrong answers were three recycled strings.

`checkSize` is optional because an import file is a partial contribution — a
file may legitimately carry three questions for one module.

### 3.5 `actions.ts` — the thirteen mutations

Every one follows the same five steps:

```ts
export async function createProspect(formData: FormData) {
  const session = await requireSession();          // 1. who
  const parsed = schema.parse({ ... });            // 2. validate (throws)
  const row = await prisma.prospect.create({...}); // 3. write
  await log(session.user.id, "CREATE", ...);       // 4. audit
  revalidatePath("/prospects");                    // 5. refresh
}
```

Scoped reads and writes spread `scopedUserFilter(session)` or inline the same
condition, so an advisor cannot modify a record assigned to someone else.

`log()` at the bottom of the file writes `AuditLog`. **Every mutation calls
it.** That table is the only durable record of who did what.

### 3.6 `format.ts` and `prisma.ts`

`format.ts` is display helpers: `inr`, `compactInr`, `dateLabel`, `maskPan`,
`maskPhone`, `titleCase`. `maskPan` and `maskPhone` matter — list views should
never show a full PAN.

`prisma.ts` is the client singleton with the standard `globalThis` guard, so
hot reload in development does not open a new connection pool every save.

---

## 4. The data model

14 models. The relationships that matter:

```
User ─┬─< Prospect ──< MeetingLog
      ├─< Client ──┬─< InvestmentPlan
      │            ├─< PortfolioReview
      │            └─< MeetingLog
      ├─< AuditLog          (SetNull — audit survives user deletion)
      ├─< QuestionItem      (author)
      ├─< TestSession ──┬─< ResponseLog
      │                 ├─< IntegrityEvent
      │                 └─── Certification (1:1)
      └─< Certification

KnowledgeCategory ──< SopEntry ──< QuestionItem
```

Things done deliberately:

- **`aum` and `amount` are `Decimal(18,2)`**, not `Float`. Money in floating
  point accumulates error. Prisma returns `Prisma.Decimal` — never convert to
  `number` for arithmetic.
- **`AuditLog.actorId` is `onDelete: SetNull`.** Deleting a user keeps the
  audit trail with a null actor. This is also why ex-staff should be
  *anonymised* rather than deleted.
- **Most children cascade.** Deleting a client removes its plans and reviews.
- **`@@unique([sessionId, questionId])`** on `ResponseLog` makes answering the
  same question twice impossible at the database level.

---

## 5. The certification flow end to end

```
/certify              lists modules, bank sizes, attempts, certifications
   │  StartTestButton (client) → POST /api/certify/start
   │       ├─ existing IN_PROGRESS session?
   │       │    ├─ expired → finalizeSession(TIMED_OUT), create fresh
   │       │    └─ live    → resume it
   │       ├─ recent FAILED attempt? → 429, cooldown
   │       ├─ bank below MINIMUM_BANK_SIZE? → 422
   │       └─ create TestSession, AuditLog, return sessionId
   ▼
/certify/session/[sessionId]                    server component
   ├─ loads session + responses
   ├─ selectNextQuestion(theta, bank, answered)
   ├─ no next question? → render with autoFinish="BANK_EXHAUSTED"
   └─ projects to { id, content, options:{key,text} }   ← correctKey stays server-side
   ▼
TestSessionClient (client component)
   ├─ useExamShell: fullscreen, countdown, integrity listeners
   └─ submit → POST /api/certify/answer
        ├─ expired? → finalizeSession(TIMED_OUT)
        ├─ score the answer, write ResponseLog
        ├─ estimateEap over all responses
        ├─ shouldStop? → finalizeSession(STOP_RULE)
        ├─ no next question? → finalizeSession(BANK_EXHAUSTED)
        └─ else → sanitizeQuestion(next), progress
```

**Correct answers never reach the browser.** Both the page and the API project
questions down to `{id, content, options:{key,text}}`. `correctKey` and
`explanation` are stripped. Verified — do not undo it.

**Proctoring is recording, not prevention.** `useExamShell` requests fullscreen
and logs fullscreen exit, tab switch, blur, copy, paste and right-click to
`IntegrityEvent`. No web API can stop a screenshot, a phone camera or a second
device, and fullscreen can always be exited — browsers guarantee that. The
value is the audit trail.

---

## 6. Operational tooling

Scripts in `scripts/` run outside the app, through `with-env.mjs`, which loads
`.env`/`.env.local` and execs the real command.

| File | Purpose |
|---|---|
| `db-target.mjs` | Classifies a connection string as local / ci / deployed / unknown. Every safety guard keys off it. Has a hand-written `.d.mts` so TypeScript callers get real types. |
| `guard-push.mjs` | Blocks `prisma db push` against anything but local |
| `check-drift.mjs` | Does the database match `schema.prisma`? |
| `snapshot.ts` | Captures contents to `backups/` before a reseed. Redacts row contents on deployed databases. |
| `questions.ts` | `check`, `template`, `import` for the question bank |
| `bootstrap-admin.ts` | Create or reset an admin account. The only password-reset path that exists. |

**Why `db-target.mjs` is plain ESM rather than TypeScript:** the npm scripts
cannot import TS, and `prisma/seed.ts` needs the same checks. Two copies of a
safety guard drift apart, so there is one implementation with a declaration
file beside it.

---

## 7. Making common changes

| Task | Files to touch |
|---|---|
| Add a CRM field | `prisma/schema.prisma` → `npm run db:migrate` → the zod schema and action in `actions.ts` → the page |
| Add a page | `src/app/(app)/<name>/page.tsx`, then the `nav` array in `app-shell.tsx` |
| Add a public page | a route group *outside* `(app)` — auth is in `AppShell`, so nothing else is needed |
| Add questions | `npm run questions:template`, fill it, `npm run questions:import <file> --apply` |
| Change test length or difficulty | the `IRT` constant in `irt.ts` |
| Change what ends a test | `FinishReason` and `finalizeSession` in `certify-session.ts` |
| Add an audit event | call `log()` from `actions.ts` — every mutation already does |

---

## 8. Gotchas

- **`redirect()` throws.** Code after `requireSession()` never runs when there
  is no session.
- **`searchParams` is a Promise** in Next 15. You must `await` it.
- **`Prisma.Decimal` is not a number.** `.toNumber()` only for display.
- **`force-dynamic` on `(app)` means `revalidatePath` mostly does nothing.**
- **ADMIN bypasses `scopedUserFilter` by design** — an admin sees everything.
- **`module` is a reserved name** in Next's CommonJS context. ESLint will fail
  the build if you use it as a variable.
- **Every `env()` in `schema.prisma` is resolved by every prisma command**,
  including `validate`. Adding one means setting it everywhere, including CI.
- **The seed deletes everything** and refuses to run outside local or CI.
  `npm run db:reseed` snapshots first.

---

## 9. Where to go next

- `docs/engineering/runbook.md` — how to operate it: environments, migrations,
  incidents, secret rotation
- `docs/engineering/adr/` — why things are the way they are
- `docs/flags.md` (local only) — what is currently wrong, with severities

To build real fluency, the highest-value exercise is to **add one CRM field end
to end**: schema, migration, validation, action, page. That touches every layer
in one pass and takes about an hour. After that, read `irt.ts` alongside its
test file — the tests describe the intended behaviour more clearly than the
implementation does.
