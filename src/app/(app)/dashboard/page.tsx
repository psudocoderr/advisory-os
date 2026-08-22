import { Clock, PlusCircle, BookOpen, Award, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { requireSession, scopedUserFilter } from "@/lib/auth";
import { compactInr, dateLabel, titleCase } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { ModuleCode } from "@prisma/client";

const trainingModules: { code: ModuleCode; title: string; dayRange: string }[] = [
  { code: "M1", title: "KYC & Regulatory Rules", dayRange: "Days 1–7" },
  { code: "M2", title: "Onboarding & Mandates", dayRange: "Days 8–14" },
  { code: "M3", title: "Platform Ops & Orders", dayRange: "Days 15–21" },
  { code: "M4", title: "Portfolio XIRR & Drift", dayRange: "Days 22–28" },
  { code: "M5", title: "Master MFD Execution", dayRange: "Days 29–30" }
];

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

  const certifiedModulesCount = certs.length;

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${session.user.name.split(" ")[0]}`}
        description={session.user.role === "ADMIN" ? "Team-wide operating snapshot & fresher readiness tracker." : "Your client work, follow-ups, and 30-day training progress."}
        action={
          <Link href="/prospects" className="inline-flex items-center gap-2 rounded bg-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal transition-colors">
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

      {/* 30-Day Operational Excellence Tracker */}
      <Card className="mt-5 p-4 border-l-4 border-l-teal">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-mint text-teal font-bold">
              <BookOpen size={18} />
            </div>
            <div>
              <h2 className="font-bold text-ink text-sm">30-Day Fresher Operational Readiness Track</h2>
              <p className="text-xs text-muted">Progress across the 4-week MFD operational excellence curriculum</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted">
              {certifiedModulesCount} of 5 Certified
            </span>
            <Link
              href="/knowledge"
              className="inline-flex items-center gap-1 text-xs font-bold text-teal hover:underline"
            >
              View Table of Contents →
            </Link>
          </div>
        </div>

        <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {trainingModules.map((module) => {
            const isCertified = certs.some((c) => c.module === module.code);
            return (
              <Link
                key={module.code}
                href={`/certify/${module.code}`}
                className={`flex flex-col justify-between rounded-lg border p-3 transition-all ${
                  isCertified
                    ? "border-teal/30 bg-mint/20 hover:border-teal"
                    : "border-line bg-wash hover:border-navy"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[10px] font-bold text-navy uppercase bg-panel px-1.5 py-0.5 rounded border border-line">
                      {module.code}
                    </span>
                    {isCertified ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-teal">
                        <CheckCircle2 size={12} /> Certified
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-muted">Pending</span>
                    )}
                  </div>
                  <div className="mt-2 text-xs font-bold text-ink leading-snug">{module.title}</div>
                </div>
                <div className="mt-2 text-[10px] text-muted font-medium border-t border-line/50 pt-1.5">
                  {module.dayRange}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>

      {/* CRM Pipeline */}
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
            <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">Active Certifications</div>
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
