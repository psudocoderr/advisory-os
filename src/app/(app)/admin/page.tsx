import { createQuestionItem, createUser, updateUserActive } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { compactInr, dateLabel, titleCase } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";

export default async function AdminPage() {
  await requireAdmin();
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [users, prospects, clients, plans, certs, expiring, attempts, audit, questionPerformance, sops] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.prospect.count(),
    prisma.client.findMany({ select: { aum: true } }),
    prisma.investmentPlan.count(),
    prisma.certification.findMany({ where: { status: "ACTIVE" }, include: { user: true }, orderBy: { module: "asc" } }),
    prisma.certification.findMany({
      where: { status: "ACTIVE", expiresAt: { gte: now, lte: soon } },
      include: { user: true },
      orderBy: { expiresAt: "asc" }
    }),
    prisma.testSession.findMany({ include: { user: true }, orderBy: { startedAt: "desc" }, take: 8 }),
    prisma.auditLog.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.questionItem.findMany({
      include: { responses: true, linkedSop: true },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.sopEntry.findMany({ where: { isPublished: true }, orderBy: [{ module: "asc" }, { title: "asc" }] })
  ]);

  const aum = clients.reduce((sum, client) => sum + Number(client.aum), 0);
  const modules = ["M1", "M2", "M3", "M4", "M5"] as const;

  return (
    <>
      <PageHeader title="Admin" description="Team-level controls, certification visibility, audit activity, and item-bank performance." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Users" value={users.length} detail="Seeded team" />
        <StatCard label="Prospects" value={prospects} detail="All advisors" />
        <StatCard label="Clients" value={clients.length} detail={compactInr(aum)} />
        <StatCard label="Plans" value={plans} detail="Across team" />
        <StatCard label="Certifications" value={certs.length} detail="Active credentials" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <SectionTitle title="Team certification status" />
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Advisor</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">M1</th>
                <th className="px-4 py-3">M2</th>
                <th className="px-4 py-3">M3</th>
                <th className="px-4 py-3">M4</th>
                <th className="px-4 py-3">M5</th>
                <th className="px-4 py-3">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 font-semibold text-ink">{user.name}</td>
                  <td className="px-4 py-3">{titleCase(user.role)}</td>
                  <td className="px-4 py-3"><StatusBadge tone={user.isActive ? "teal" : "rose"}>{user.isActive ? "Active" : "Inactive"}</StatusBadge></td>
                  {modules.map((module) => {
                    const cert = certs.find((item) => item.userId === user.id && item.module === module);
                    return (
                      <td key={module} className="px-4 py-3">
                        {cert ? <StatusBadge tone="teal">{cert.level}</StatusBadge> : <StatusBadge>Not taken</StatusBadge>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3">
                    <form action={updateUserActive}>
                      <input type="hidden" name="id" value={user.id} />
                      <input type="hidden" name="isActive" value={user.isActive ? "false" : "true"} />
                      <button className="rounded border border-line px-2 py-1 text-xs font-bold">
                        {user.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <SectionTitle title="Add team user" flush />
          <form action={createUser} className="mt-4 space-y-3">
            <input className="field" name="name" placeholder="Full name" required />
            <input className="field" name="email" type="email" placeholder="email@company.com" required />
            <div className="grid grid-cols-2 gap-3">
              <select className="field" name="role" defaultValue="ADVISOR">
                <option value="ADVISOR">Advisor</option>
                <option value="ADMIN">Admin</option>
              </select>
              <input className="field" name="password" type="password" placeholder="Temporary password" minLength={8} required />
            </div>
            <button className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white">Create user</button>
          </form>
        </Card>

        <Card>
          <SectionTitle title="Expiry alerts" />
          <div className="divide-y divide-line">
            {expiring.length ? expiring.map((cert) => (
              <div key={cert.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-semibold text-ink">{cert.user.name}</div>
                  <div className="text-sm text-muted">{cert.module} expires {dateLabel(cert.expiresAt)}</div>
                </div>
                <StatusBadge tone="amber">{cert.level}</StatusBadge>
              </div>
            )) : <div className="px-4 py-6 text-sm text-muted">No certifications expiring in the next 30 days.</div>}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Attempt history" />
          <div className="divide-y divide-line">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-semibold text-ink">{attempt.user.name} • {attempt.module}</div>
                  <div className="text-sm text-muted">Attempt {attempt.attemptNumber} • theta {attempt.abilityEstimate.toFixed(2)} • SE {attempt.standardError.toFixed(2)}</div>
                </div>
                <StatusBadge tone={attempt.status === "PASSED" ? "teal" : attempt.status === "FAILED" ? "rose" : "navy"}>
                  {titleCase(attempt.status)}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Audit log" />
          <div className="divide-y divide-line">
            {audit.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-ink">{item.summary}</div>
                  <StatusBadge tone="navy">{item.action}</StatusBadge>
                </div>
                <div className="mt-1 text-xs text-muted">{item.actor?.name || "System"} • {dateLabel(item.createdAt)} • {item.entity}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-5 p-4">
        <SectionTitle title="Add certification question" flush />
        <form action={createQuestionItem} className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <select className="field" name="module" defaultValue="M1">
                {modules.map((module) => (
                  <option key={module} value={module}>{module}</option>
                ))}
              </select>
              <select className="field" name="linkedSopId" required>
                <option value="">Linked SOP</option>
                {sops.map((sop) => (
                  <option key={sop.id} value={sop.id}>{sop.module || "General"} - {sop.title}</option>
                ))}
              </select>
            </div>
            <textarea className="field min-h-24" name="content" placeholder="Question stem" required />
            <textarea className="field min-h-20" name="explanation" placeholder="Explanation shown in admin review context" required />
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="field" name="optionA" placeholder="Option A" required />
              <input className="field" name="optionB" placeholder="Option B" required />
              <input className="field" name="optionC" placeholder="Option C" required />
              <input className="field" name="optionD" placeholder="Option D" required />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <select className="field" name="correctKey" defaultValue="A">
                {["A", "B", "C", "D"].map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
              <input className="field" name="difficulty" type="number" step="0.1" min="-4" max="4" defaultValue="0" />
              <input className="field" name="discrimination" type="number" step="0.1" min="0.25" max="3" defaultValue="1" />
              <input className="field" name="guessing" type="number" step="0.01" min="0" max="0.5" defaultValue="0.2" />
            </div>
            <button className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white">Add question</button>
          </div>
        </form>
      </Card>

      <Card className="mt-5 overflow-hidden">
        <SectionTitle title="Item performance report" />
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Question</th>
              <th className="px-4 py-3">Module</th>
              <th className="px-4 py-3">SOP</th>
              <th className="px-4 py-3">Attempts</th>
              <th className="px-4 py-3">% Correct</th>
              <th className="px-4 py-3">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {questionPerformance.map((question) => {
              const attemptsCount = question.responses.length;
              const correct = attemptsCount ? Math.round((question.responses.filter((item) => item.isCorrect).length / attemptsCount) * 100) : 0;
              const flag = attemptsCount === 0 ? "No data" : correct > 80 ? "Too easy" : correct < 20 ? "Review item" : "Healthy";
              return (
                <tr key={question.id}>
                  <td className="max-w-lg px-4 py-3">{question.content}</td>
                  <td className="px-4 py-3">{question.module}</td>
                  <td className="px-4 py-3">{question.linkedSop.title}</td>
                  <td className="mono px-4 py-3">{attemptsCount}</td>
                  <td className="mono px-4 py-3">{attemptsCount ? `${correct}%` : "—"}</td>
                  <td className="px-4 py-3"><StatusBadge tone={flag === "Healthy" ? "teal" : flag === "No data" ? "slate" : "amber"}>{flag}</StatusBadge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function SectionTitle({ title, flush = false }: { title: string; flush?: boolean }) {
  return <div className={flush ? "text-xs font-bold uppercase tracking-wide text-muted" : "border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted"}>{title}</div>;
}
