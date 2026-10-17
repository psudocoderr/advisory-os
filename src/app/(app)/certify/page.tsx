import Link from "next/link";
import { Award, ClipboardCheck, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { LEVEL_LABEL } from "@/lib/irt";
import { loadTrackProgress } from "@/lib/knowledge";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge } from "@/components/ui";

export default async function CertifyPage() {
  const session = await requireSession();
  const tracks = await prisma.track.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
  const [standings, certifications, counts] = await Promise.all([
    Promise.all(tracks.map((track) => loadTrackProgress({ id: track.id }, session.user))),
    prisma.certification.findMany({
      where: { status: "ACTIVE", ...(session.user.role === "ADMIN" ? {} : { userId: session.user.id }) },
      orderBy: { issuedAt: "desc" },
      include: { user: true, topic: true, track: true }
    }),
    prisma.questionItem.groupBy({ by: ["topicId"], where: { isActive: true }, _count: true })
  ]);

  return (
    <>
      <PageHeader title="Tests & badges" description="Each topic closes with an adaptive test that awards a badge." />
      {standings.map((standing) =>
        standing ? (
          <div key={standing.track.id} className="mb-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">{standing.track.title}</h2>
            {standing.track.modules.map((module, moduleIndex) => {
              const moduleStanding = standing.moduleProgress[moduleIndex];
              return (
                <div key={module.id} className="mb-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-ink">
                      Module {module.number} · {module.title}
                    </h3>
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                      <Award size={14} className={moduleStanding.badged ? "text-teal" : ""} />
                      {moduleStanding.badgeLevel
                        ? `Module badge: ${LEVEL_LABEL[moduleStanding.badgeLevel]}`
                        : `${moduleStanding.topicsPassed} of ${moduleStanding.topicsCounted} topics passed`}
                    </span>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {module.topics.map((topic) => {
                      const topicStanding = standing.progress.find((row) => row.id === topic.id)!;
                      if (topicStanding.comingSoon) return null;
                      const level = standing.badgeLevels.get(topic.id);
                      const questionCount = counts.find((item) => item.topicId === topic.id)?._count ?? 0;
                      return (
                        <Card key={topic.id} className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-mint text-teal">
                              <ClipboardCheck size={20} />
                            </div>
                            <div>
                              <h4 className="font-semibold text-ink">
                                {topic.number} {topic.title}
                              </h4>
                              <div className="mt-1 text-sm text-muted">
                                {questionCount} questions · {level ? LEVEL_LABEL[level] : "No badge yet"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 flex justify-end border-t border-line pt-4">
                            {topicStanding.testUnlocked ? (
                              <Link
                                href={`/certify/${topic.id}`}
                                className="rounded bg-navy px-3 py-2 text-sm font-semibold text-white"
                              >
                                {level ? "Retake" : "Start"}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                                <Lock size={14} />
                                Locked
                              </span>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null
      )}
      <Card className="mt-5 p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold text-ink">
          <Award size={18} />
          Badges
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {certifications.length ? (
            certifications.slice(0, 8).map((cert) => (
              <div key={cert.id} className="rounded border border-line bg-wash p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {cert.topic?.title ?? `${cert.track.title} certificate`}
                  </span>
                  {cert.badgeLevel ? <StatusBadge tone="teal">{LEVEL_LABEL[cert.badgeLevel]}</StatusBadge> : null}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {session.user.role === "ADMIN" ? `${cert.user.name} • ` : ""}Issued {dateLabel(cert.issuedAt)}
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted">No badges yet.</div>
          )}
        </div>
      </Card>
    </>
  );
}
