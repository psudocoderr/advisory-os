import { Clock, PlusCircle } from "lucide-react";
import Link from "next/link";
import { requireSession, scopedUserFilter } from "@/lib/auth";
import { compactInr, dateLabel, titleCase } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";

export default async function DashboardPage() {
  const session = await requireSession();
  const scope = scopedUserFilter(session);
  const meetingScope = session.user.role === "ADMIN" ? {} : { ownerId: session.user.id };
  const now = new Date();

  const [meetings, prospects, clients, plans, reviews, recent, upcoming, reviewDue, certs] = await Promise.all([
    prisma.meetingLog.count({ where: meetingScope }),
    prisma.prospect.groupBy({ by: ["stage"], where: scope, _count: true }),
    prisma.client.findMany({ where: scope, select: { aum: true, kycStatus: true } }),
    prisma.investmentPlan.count({ where: { client: scope } }),
    prisma.portfolioReview.count({ where: { client: scope } }),
    prisma.meetingLog.findMany({
      where: meetingScope,
      orderBy: { meetingDate: "desc" },
      take: 7,
      include: { prospect: true, client: true, owner: true }
    }),
    prisma.meetingLog.findMany({
      where: { ...meetingScope, followUpDate: { gte: now } },
      orderBy: { followUpDate: "asc" },
      take: 5,
      include: { prospect: true, client: true }
    }),
    prisma.portfolioReview.findMany({
      where: {
        client: scope,
        nextReviewDate: { gte: now }
      },
      orderBy: { nextReviewDate: "asc" },
      take: 5,
      include: { client: true }
    }),
    prisma.certification.findMany({
      where: { status: "ACTIVE", expiresAt: { gte: now }, ...(session.user.role === "ADMIN" ? {} : { userId: session.user.id }) },
      orderBy: { issuedAt: "desc" },
      take: 5,
      include: { user: true }
    })
  ]);

  const aum = clients.reduce((sum, client) => sum + Number(client.aum), 0);
  const pendingKyc = clients.filter((client) => client.kycStatus !== "VERIFIED").length;
  const pipeline = ["LEAD", "MEETING_HELD", "PLAN_SENT", "ONBOARDED", "DROPPED"].map((stage) => ({
    stage,
    count: prospects.find((item) => item.stage === stage)?._count ?? 0
  }));

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${session.user.name.split(" ")[0]}`}
        description={session.user.role === "ADMIN" ? "Team-wide operating snapshot." : "Your client work, follow-ups, and certification status."}
        action={
          <Link href="/prospects" className="inline-flex items-center gap-2 rounded bg-navy px-3 py-2 text-sm font-semibold text-white">
            <PlusCircle size={16} />
            Add activity
          </Link>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Meetings" value={meetings} detail="Logged interactions" />
        <StatCard label="Clients" value={clients.length} detail={`${pendingKyc} KYC attention`} />
        <StatCard label="AUM" value={compactInr(aum)} detail="Scoped portfolio value" />
        <StatCard label="Plans" value={plans} detail="Draft to active" />
        <StatCard label="Reviews" value={reviews} detail="Portfolio reviews" />
      </div>

      <Card className="mt-5 p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Pipeline</div>
        <div className="grid gap-3 md:grid-cols-5">
          {pipeline.map((item) => (
            <Link key={item.stage} href={`/prospects?stage=${item.stage}`} className="rounded border border-line bg-wash p-3 hover:border-teal">
              <div className="mono text-xl font-semibold text-ink">{item.count}</div>
              <div className="mt-1 text-xs font-bold text-muted">{titleCase(item.stage)}</div>
            </Link>
          ))}
        </div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">Recent activity</div>
          <div className="divide-y divide-line">
            {recent.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div>
                  <div className="font-semibold text-ink">{item.prospect?.name || item.client?.name || "General activity"}</div>
                  <div className="mt-1 text-sm text-muted">{item.summary}</div>
                  <div className="mt-1 text-xs text-muted">
                    {dateLabel(item.meetingDate)} {session.user.role === "ADMIN" ? `• ${item.owner.name}` : ""}
                  </div>
                </div>
                <StatusBadge tone={item.kind === "REVIEW" ? "amber" : item.kind === "CLIENT" ? "teal" : "navy"}>{titleCase(item.kind)}</StatusBadge>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">Upcoming follow-ups</div>
            <div className="divide-y divide-line">
              {upcoming.length ? (
                upcoming.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <Clock size={16} className="text-amber" />
                    <div>
                      <div className="text-sm font-semibold text-ink">{item.prospect?.name || item.client?.name}</div>
                      <div className="text-xs text-muted">{item.followUpDate ? dateLabel(item.followUpDate) : ""}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No upcoming follow-ups.</div>
              )}
            </div>
          </Card>
          <Card>
            <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">Upcoming reviews</div>
            <div className="divide-y divide-line">
              {reviewDue.length ? (
                reviewDue.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <Clock size={16} className="text-teal" />
                    <div>
                      <div className="text-sm font-semibold text-ink">{item.client.name}</div>
                      <div className="text-xs text-muted">{dateLabel(item.nextReviewDate)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No upcoming reviews.</div>
              )}
            </div>
          </Card>
          <Card>
            <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">Certification</div>
            <div className="divide-y divide-line">
              {certs.length ? (
                certs.map((cert) => (
                  <div key={cert.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-ink">{cert.module}</div>
                      <StatusBadge tone="teal">{cert.level}</StatusBadge>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {session.user.role === "ADMIN" ? `${cert.user.name} • ` : ""}Expires {dateLabel(cert.expiresAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No active certifications yet.</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
