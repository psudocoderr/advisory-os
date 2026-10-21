/**
 * End-to-end checks against a running production build (`next start`), over
 * HTTP with real sign-in cookies, as a browser would. What only a real build
 * shows: the proxy and security headers, the sign-in cookie and the
 * per-request account re-check, server components deciding who sees which
 * page, server actions over their wire format, and what actually reaches the
 * browser (HTML and RSC payload).
 *
 * 1. Access matrix: every page and API route as signed out, advisor A,
 *    advisor B, admin, and a user deactivated after signing in.
 * 2. Advisors see only their own records.
 * 3. Server actions called the way the browser calls them.
 * 4. Security headers.
 * 5. Leak scan of every rendered page, RSC payload included: no password
 *    hash, full PAN or mobile, answer key or explanation where it must not be.
 *
 * Needs a disposable database (local or CI host, name ending in _test); it is
 * emptied first. Usage, with the server already running on BASE_URL:
 *   tsx tests/e2e/run.ts [results.json]
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { classifyDatabaseTarget, isEphemeral } from "../../scripts/db-target.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = resolve(process.argv[2] ?? "test-results/e2e.json");
const PASSWORD = "e2e passphrase only";

type Check = { area: string; name: string; expected: string; actual: string; pass: boolean };
const results: Check[] = [];
function check(area: string, name: string, expected: unknown, actual: unknown) {
  const [e, a] = [String(expected), String(actual)];
  results.push({ area, name, expected: e, actual: a, pass: e === a });
  console.log(`${e === a ? "PASS" : "FAIL"} [${area}] ${name} :: expected ${e}, got ${a}`);
}

// --- HTTP, the way a browser does it ----------------------------------------

async function signIn(email: string): Promise<string> {
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  const jar = csrf.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.join("; ") },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, json: "true" })
  });
  jar.push(...response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]));
  const cookie = jar.join("; ");
  if (!cookie.includes("session-token")) throw new Error(`sign-in failed for ${email}`);
  return cookie;
}

type Page = { status: number; outcome: string; html: string; headers: Headers };

/** "200", "404", or "redirect /path" (an HTTP redirect, or one streamed in the page). */
async function page(cookie: string | null, path: string): Promise<Page> {
  const response = await fetch(BASE + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  const html = await response.text();
  const target = response.headers.get("location") ?? html.match(/NEXT_REDIRECT;[a-z]+;([^;"]+);/)?.[1];
  const outcome = target
    ? `redirect ${new URL(target, BASE).pathname}`
    : response.status === 404 || html.includes("NEXT_HTTP_ERROR_FALLBACK;404")
      ? "404"
      : String(response.status);
  return { status: response.status, outcome, html, headers: response.headers };
}

async function api(cookie: string | null, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.edge") as {
  encodeReply: (value: unknown) => Promise<string | FormData>;
};
const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as {
  node: Record<string, { exportedName: string }>;
};
const actionId = (name: string) => {
  const entry = Object.entries(manifest.node).find(([, value]) => value.exportedName === name);
  if (!entry) throw new Error(`no server action named ${name} in the build`);
  return entry[0];
};

/** Calls a server action as a form post from the browser does. */
async function action(cookie: string | null, name: string, fields: Record<string, string>, withPrevState: boolean) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(`${BASE}/dashboard`, {
    method: "POST",
    redirect: "manual",
    headers: { "Next-Action": actionId(name), Accept: "text/x-component", ...(cookie ? { Cookie: cookie } : {}) },
    body: await encodeReply(withPrevState ? [{}, form] : [form])
  });
  const text = await response.text();
  const redirect = response.headers.get("x-action-redirect")?.split(";")[0];
  // Line "1:" carries the return value, or "E{...}" for a thrown error.
  const line = text.match(/^1:(.*)$/m)?.[1];
  return redirect ? `redirect ${redirect}` : line?.startsWith("E") ? "thrown" : `returned ${line ?? response.status}`;
}

// --- Run ---------------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  const name = url ? new URL(url).pathname.slice(1) : "";
  if (!isEphemeral(classifyDatabaseTarget(url)) || !name.endsWith("_test")) {
    throw new Error(`refusing ${name || "no database"}: e2e empties it, so it must be local/CI and end in _test`);
  }
  const db = new PrismaClient();

  // Fixtures: an empty database, then exactly what the checks need.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const user = (key: string, role: "ADMIN" | "ADVISOR" = "ADVISOR") =>
    db.user.create({ data: { email: `${key}@e2e.local`, name: `E2E ${key}`, passwordHash: hash, role } });
  const [admin, a, b, gone, spare] = [
    await user("admin", "ADMIN"),
    await user("advisor-a"),
    await user("advisor-b"),
    await user("deactivated"),
    await user("spare")
  ];

  const track = await db.track.create({ data: { slug: "e2e-track", title: "E2E Track", order: 1 } });
  const mod = await db.module.create({ data: { trackId: track.id, slug: "basics", title: "Basics", order: 1 } });
  const topic = await db.topic.create({
    data: { moduleId: mod.id, slug: "onboarding", title: "Onboarding", order: 0 }
  });
  const chapter = await db.chapter.create({
    data: { topicId: topic.id, slug: "first", title: "First", order: 1, isPublished: true, body: "# First" }
  });
  const keys = ["A", "B", "C", "D"];
  await db.questionItem.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      topicId: topic.id,
      chapterId: chapter.id,
      content: `E2E question ${i}?`,
      options: keys.map((key) => ({ key, text: `Option ${key}${i}` })),
      correctKey: keys[i % 4],
      explanation: `E2E secret explanation ${i}`,
      difficulty: -2 + (4 * i) / 11,
      createdById: admin.id
    }))
  });
  const questions = await db.questionItem.findMany({ where: { topicId: topic.id } });

  /** A prospect, a client (with a plan and a review) for an advisor; names, PANs and mobiles are unique. */
  async function book(owner: { id: string }, tag: string, n: number) {
    await db.prospect.create({
      data: {
        name: `Prospect of ${tag}`,
        phone: `+9190000000${n}1`,
        source: "REFERRAL",
        firstContactDate: new Date(),
        notes: "",
        assignedToId: owner.id
      }
    });
    const client = await db.client.create({
      data: {
        name: `Client of ${tag}`,
        phone: `+9190000000${n}2`,
        pan: `PQRS${tag}${n}234Z`.slice(0, 10),
        aum: 500000,
        onboardingDate: new Date(),
        assignedToId: owner.id
      }
    });
    await db.investmentPlan.create({
      data: { clientId: client.id, planType: "SIP", amount: 1000, frequency: "MONTHLY", goal: "WEALTH", notes: "" }
    });
    await db.portfolioReview.create({
      data: {
        clientId: client.id,
        reviewDate: new Date(),
        currentAum: 500000,
        returns: 4,
        actions: `Review of ${tag}`,
        nextReviewDate: new Date()
      }
    });
    return client;
  }
  const clientA = await book(a, "A", 1);
  await book(b, "B", 2);
  const allClients = await db.client.findMany({ select: { pan: true, phone: true } });
  const allProspects = await db.prospect.findMany({ select: { phone: true } });

  // A finished attempt by A: a result page only A may see.
  const attempt = await db.testSession.create({
    data: {
      userId: a.id,
      trackId: track.id,
      topicId: topic.id,
      status: "FAILED",
      timerStartedAt: new Date(),
      completedAt: new Date(),
      abilityEstimate: -1,
      standardError: 0.4
    }
  });
  await db.responseLog.createMany({
    data: questions.slice(0, 10).map((q) => ({
      sessionId: attempt.id,
      questionId: q.id,
      selectedKey: keys.find((key) => key !== q.correctKey)!,
      isCorrect: false,
      responseTimeMs: 1000,
      abilityAfter: -1,
      seAfter: 0.4
    }))
  });

  const cookies = {
    admin: await signIn(admin.email),
    a: await signIn(a.email),
    b: await signIn(b.email),
    gone: await signIn(gone.email)
  };
  // Deactivated after signing in: the cookie is still valid, the account is not.
  await db.user.update({ where: { id: gone.id }, data: { isActive: false } });

  const roles = [
    ["signed out", null],
    ["advisor A", cookies.a],
    ["advisor B", cookies.b],
    ["admin", cookies.admin],
    ["deactivated", cookies.gone]
  ] as const;
  type Role = (typeof roles)[number][0];

  // --- 1. Access matrix -------------------------------------------------------
  const app = (expectations: Partial<Record<Role, string>>) => ({
    "signed out": "redirect /login",
    "advisor A": "200",
    "advisor B": "200",
    admin: "200",
    deactivated: "redirect /login",
    ...expectations
  });
  const adminOnly = app({ "advisor A": "redirect /dashboard", "advisor B": "redirect /dashboard" });
  const pages: [string, Record<Role, string>][] = [
    ["/login", { "signed out": "200", "advisor A": "200", "advisor B": "200", admin: "200", deactivated: "200" }],
    [
      "/",
      {
        "signed out": "redirect /dashboard",
        "advisor A": "redirect /dashboard",
        "advisor B": "redirect /dashboard",
        admin: "redirect /dashboard",
        deactivated: "redirect /dashboard"
      }
    ],
    ["/dashboard", app({})],
    ["/prospects", app({})],
    ["/clients", app({})],
    ["/plans", app({})],
    ["/reviews", app({})],
    ["/guide", app({})],
    // With a single track, the list goes straight to it.
    [
      "/knowledge",
      app({
        "advisor A": `redirect /knowledge/${track.slug}`,
        "advisor B": `redirect /knowledge/${track.slug}`,
        admin: `redirect /knowledge/${track.slug}`
      })
    ],
    [`/knowledge/${track.slug}`, app({})],
    [`/knowledge/${track.slug}/${mod.slug}/${topic.slug}/${chapter.slug}`, app({})],
    ["/certify", app({})],
    [`/certify/${topic.id}`, app({})],
    [`/certify/session/${attempt.id}`, app({ "advisor B": "404", admin: "404" })],
    ["/admin", adminOnly],
    ["/admin/knowledge", adminOnly],
    [`/admin/knowledge/chapters/${chapter.id}`, adminOnly],
    ["/admin/tracker", adminOnly],
    [`/admin/tracker/${a.id}`, adminOnly],
    [`/admin/tracker/${a.id}/${attempt.id}`, adminOnly]
  ];
  const rendered: { role: Role; path: string; html: string }[] = [];
  for (const [path, expected] of pages) {
    for (const [role, cookie] of roles) {
      const result = await page(cookie, path);
      check("1 pages", `${role} GET ${path}`, expected[role], result.outcome);
      if (result.outcome === "200") rendered.push({ role, path, html: result.html });
    }
  }

  const certify = { "signed out": 401, "advisor A": 400, "advisor B": 400, admin: 400, deactivated: 401 };
  const routes: [string, "GET" | "POST", string, Record<Role, number>][] = [
    ...["start", "question", "answer", "finish", "integrity"].map(
      (name): [string, "GET" | "POST", string, Record<Role, number>] => [
        `POST /api/certify/${name} (empty body)`,
        "POST",
        `/api/certify/${name}`,
        certify
      ]
    ),
    [
      "POST /api/uploads (empty body)",
      "POST",
      "/api/uploads",
      { "signed out": 401, "advisor A": 403, "advisor B": 403, admin: 503, deactivated: 401 }
    ],
    [
      "GET /api/files/unknown",
      "GET",
      "/api/files/unknown",
      { "signed out": 401, "advisor A": 503, "advisor B": 503, admin: 503, deactivated: 401 }
    ],
    [
      "GET /api/reports/<advisor A>",
      "GET",
      `/api/reports/${a.id}`,
      { "signed out": 401, "advisor A": 403, "advisor B": 403, admin: 200, deactivated: 401 }
    ],
    [
      "GET /api/health",
      "GET",
      "/api/health",
      { "signed out": 200, "advisor A": 200, "advisor B": 200, admin: 200, deactivated: 200 }
    ]
  ];
  for (const [label, method, path, expected] of routes) {
    for (const [role, cookie] of roles) {
      const response = await api(cookie, method, path, method === "POST" ? {} : undefined);
      check("1 api", `${role} ${label}`, expected[role], response.status);
    }
  }

  // --- 2. Advisors see only their own records -----------------------------------
  for (const path of ["/prospects", "/clients", "/plans", "/reviews"]) {
    const [own, other, all] = [
      (await page(cookies.a, path)).html,
      (await page(cookies.b, path)).html,
      (await page(cookies.admin, path)).html
    ];
    const marker = path === "/reviews" ? "Review of A" : path === "/prospects" ? "Prospect of A" : "Client of A";
    check("2 scoping", `advisor A sees "${marker}" on ${path}`, true, own.includes(marker));
    check("2 scoping", `advisor B does not see "${marker}" on ${path}`, false, other.includes(marker));
    check("2 scoping", `admin sees "${marker}" on ${path}`, true, all.includes(marker));
  }

  // --- 3. Server actions over the wire ------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  check(
    "3 actions",
    "advisor B changing advisor A's client KYC",
    "thrown",
    await action(cookies.b, "updateClientKyc", { id: clientA.id, kycStatus: "EXPIRED" }, false)
  );
  check(
    "3 actions",
    "advisor A's client KYC unchanged",
    "PENDING",
    (await db.client.findUniqueOrThrow({ where: { id: clientA.id } })).kycStatus
  );
  const created = await action(
    cookies.a,
    "createUser",
    { name: "Intruder", email: "intruder@e2e.local", password: "long enough password", role: "ADMIN" },
    true
  );
  check("3 actions", "advisor creating an admin account", "redirect /dashboard", created);
  check("3 actions", "no account created", 0, await db.user.count({ where: { email: "intruder@e2e.local" } }));
  check(
    "3 actions",
    "signed-out reorder",
    "redirect /login",
    await action(null, "moveKnowledgeItem", { kind: "topic", id: topic.id, direction: "up" }, false)
  );
  check(
    "3 actions",
    "deactivated user adding a prospect",
    "redirect /login",
    await action(
      cookies.gone,
      "createProspect",
      { name: "Ghost", phone: "9123456780", source: "EVENT", stage: "LEAD", firstContactDate: today },
      true
    )
  );
  check(
    "3 actions",
    "no prospect added by the deactivated user",
    0,
    await db.prospect.count({ where: { name: "Ghost" } })
  );
  // Positive control: the same wire format works for someone allowed to.
  await action(cookies.admin, "updateUserActive", { id: spare.id, isActive: "false" }, true);
  check(
    "3 actions",
    "admin deactivates an account",
    false,
    (await db.user.findUniqueOrThrow({ where: { id: spare.id } })).isActive
  );

  // --- 4. Security headers ---------------------------------------------------------
  const dashboard = await page(cookies.a, "/dashboard");
  const csp = dashboard.headers.get("content-security-policy") ?? "";
  check("4 headers", "CSP scripts need a nonce", true, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp));
  check("4 headers", "CSP object-src none", true, csp.includes("object-src 'none'"));
  check("4 headers", "CSP frame-ancestors none", true, csp.includes("frame-ancestors 'none'"));
  check(
    "4 headers",
    "a fresh nonce per response",
    false,
    csp === (await page(cookies.a, "/dashboard")).headers.get("content-security-policy")
  );
  check("4 headers", "X-Frame-Options", "DENY", dashboard.headers.get("x-frame-options"));
  check("4 headers", "X-Content-Type-Options", "nosniff", dashboard.headers.get("x-content-type-options"));
  check("4 headers", "Referrer-Policy", "strict-origin-when-cross-origin", dashboard.headers.get("referrer-policy"));
  check(
    "4 headers",
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
    dashboard.headers.get("permissions-policy")
  );
  check("4 headers", "no X-Powered-By on pages", null, dashboard.headers.get("x-powered-by"));
  check(
    "4 headers",
    "no X-Powered-By on the API",
    null,
    (await api(null, "GET", "/api/health")).headers.get("x-powered-by")
  );
  check(
    "4 headers",
    "API responses nosniff",
    "nosniff",
    (await api(null, "GET", "/api/health")).headers.get("x-content-type-options")
  );
  check("4 headers", "session cookie is HttpOnly", true, (await sessionCookieFlags(admin.email)).includes("httponly"));

  // --- 5. Leak scan ------------------------------------------------------------------
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const anywhere: [string, RegExp][] = [
    ["bcrypt hash", /\$2[aby]\$\d\d\$/],
    ["passwordHash field", /passwordHash/],
    ["full PAN", new RegExp(allClients.map((c) => c.pan).join("|"))],
    ["full mobile", new RegExp([...allClients, ...allProspects].map((p) => escape(p.phone)).join("|"))],
    ["storage secret", /STORAGE_SECRET|secretAccessKey/]
  ];
  const traineeOnly: [string, RegExp][] = [
    ["answer key", /correctKey/],
    ["question explanation", /E2E secret explanation/]
  ];
  // A full page load carries the RSC payload inline (self.__next_f), which is
  // everything handed to client components; scanning the HTML scans that too.
  // A page without it was not fully rendered, and must not count as clean.
  for (const { role, path, html } of rendered) {
    if (!html.includes("self.__next_f")) {
      check("5 leaks", `${role} ${path}`, "clean", "no RSC payload in the page to scan");
      continue;
    }
    const patterns = role === "admin" ? anywhere : [...anywhere, ...traineeOnly];
    const hits = patterns.filter(([, pattern]) => pattern.test(html)).map(([label]) => label);
    check("5 leaks", `${role} ${path}`, "clean", hits.length ? hits.join(", ") : "clean");
  }
  const csv = (await api(cookies.admin, "GET", `/api/reports/${a.id}`)).text;
  check("5 leaks", "admin CSV report", "clean", /\$2[aby]\$|correctKey|explanation/.test(csv) ? "leak" : "clean");

  await db.$disconnect();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; results in ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}

/** The attributes on the session cookie a fresh sign-in sets, lowercased. */
async function sessionCookieFlags(email: string) {
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  const jar = csrf.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.join("; ") },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, json: "true" })
  });
  return (response.headers.getSetCookie().find((cookie) => cookie.includes("session-token")) ?? "").toLowerCase();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
