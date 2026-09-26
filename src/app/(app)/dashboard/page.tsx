import { Clock, PlusCircle, BookOpen, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { requireSession, scopedUserFilter } from "@/lib/auth";
import { compactInr, dateLabel, titleCase } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { LEVEL_LABEL } from "@/lib/irt";
import { loadTrackProgress } from "@/lib/knowledge";

export default async function DashboardPage() {
  const session = await requireSession();
  const scope = scopedUserFilter(session);
  const meetingScope = session.user.role === "ADMIN" ? {} : { ownerId: session.user.id };
  const now = new Date();

  const firstTrack = await prisma.track.findFirst({ where: { isActive: true }, orderBy: { order: "asc" } });
  const [meetings, prospects, clients, plans, reviews, recent, upcoming, reviewDue, certs, standing] =
    await Promise.all([
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
        where: {
          status: "ACTIVE",
          ...(session.user.role === "ADMIN" ? {} : { userId: session.user.id })
        },
        orderBy: { issuedAt: "desc" },
        take: 5,
        include: { user: true, trainingModule: { select: { title: true } }, track: { select: { title: true } } }
      }),
      firstTrack ? loadTrackProgress({ id: firstTrack.id }, session.user) : null
    ]);

  const aum = clients.reduce((sum, client) => sum + Number(client.aum), 0);
  const pendingKyc = clients.filter((client) => client.kycStatus !== "VERIFIED").length;
  const pipeline = ["LEAD", "MEETING_HELD", "PLAN_SENT", "ONBOARDED", "DROPPED"].map((stage) => ({
    stage,
    count: prospects.find((item) => item.stage === stage)?._count ?? 0
  }));

  const trainingModules = standing
    ? standing.track.modules.map((module, index) => ({ ...module, progress: standing.progress[index] }))
    : [];
  const badgedCount = trainingModules.filter((module) => module.progress.badged).length;

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${session.user.name.split(" ")[0]}`}
        description={
          session.user.role === "ADMIN"
            ? "Team-wide operating snapshot & fresher readiness tracker."
            : "Your client work, follow-ups, and training progress."
        }
        action={
          <Link
            href="/prospects"
            className="inline-flex items-center gap-2 rounded bg-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal transition-colors"
          >
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

      {standing ? (
        <Card className="mt-5 border-l-4 border-l-teal p-4">
          <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-mint font-bold text-teal">
                <BookOpen size={18} />
              </div>
              <h2 className="text-sm font-bold text-ink">{standing.track.title}</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-muted">
                {badgedCount} of {trainingModules.length} badges
              </span>
              <Link
                href={`/knowledge/${standing.track.slug}`}
                className="inline-flex items-center gap-1 text-xs font-bold text-teal hover:underline"
              >
                Continue →
              </Link>
            </div>
          </div>

          <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {trainingModules.map((module, index) => {
              const level = standing.badgeLevels.get(module.id);
              return (
                <div
                  key={module.id}
                  className={`flex flex-col justify-between rounded-lg border p-3 ${
                    module.progress.badged ? "border-teal/30 bg-mint/20" : "border-line bg-wash"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] font-bold text-navy">
                      {index + 1}
                    </span>
                    {level ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-teal">
                        <CheckCircle2 size={12} /> {LEVEL_LABEL[level]}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs font-bold leading-snug text-ink">{module.title}</div>
                  <div className="mt-2 border-t border-line/50 pt-1.5 text-[10px] font-medium text-muted">
                    {module.progress.chaptersDone}/{module.chapters.length} chapters
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* CRM Pipeline */}
      <Card className="mt-5 p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Pipeline</div>
        <div className="grid gap-3 md:grid-cols-5">
          {pipeline.map((item) => (
            <Link
              key={item.stage}
              href={`/prospects?stage=${item.stage}`}
              className="rounded border border-line bg-wash p-3 hover:border-teal"
            >
              <div className="mono text-xl font-semibold text-ink">{item.count}</div>
              <div className="mt-1 text-xs font-bold text-muted">{titleCase(item.stage)}</div>
            </Link>
          ))}
        </div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Card>
          <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">
            Recent activity
          </div>
          <div className="divide-y divide-line">
            {recent.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div>
                  <div className="font-semibold text-ink">
                    {item.prospect?.name || item.client?.name || "General activity"}
                  </div>
                  <div className="mt-1 text-sm text-muted">{item.summary}</div>
                  <div className="mt-1 text-xs text-muted">
                    {dateLabel(item.meetingDate)} {session.user.role === "ADMIN" ? `• ${item.owner.name}` : ""}
                  </div>
                </div>
                <StatusBadge tone={item.kind === "REVIEW" ? "amber" : item.kind === "CLIENT" ? "teal" : "navy"}>
                  {titleCase(item.kind)}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">
              Upcoming follow-ups
            </div>
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
            <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">
              Upcoming reviews
            </div>
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
            <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">
              Badges
            </div>
            <div className="divide-y divide-line">
              {certs.length ? (
                certs.map((cert) => (
                  <div key={cert.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-ink">
                        {cert.trainingModule?.title ?? cert.track?.title}
                      </div>
                      {cert.badgeLevel ? <StatusBadge tone="teal">{LEVEL_LABEL[cert.badgeLevel]}</StatusBadge> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {session.user.role === "ADMIN" ? `${cert.user.name} • ` : ""}
                      Issued {dateLabel(cert.issuedAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-sm text-muted">No badges yet.</div>
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
