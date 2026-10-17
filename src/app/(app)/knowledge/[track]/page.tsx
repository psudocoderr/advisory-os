import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, Clock, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { LEVEL_LABEL } from "@/lib/irt";
import { chapterHref, loadTrackProgress } from "@/lib/knowledge";
import { Card, HowThisWorks, PageHeader, StatusBadge } from "@/components/ui";
import { ChapterStateIcon } from "@/components/knowledge";

export default async function TrackPage({ params }: { params: Promise<{ track: string }> }) {
  const session = await requireSession();
  const { track: slug } = await params;
  const standing = await loadTrackProgress({ slug }, session.user);
  if (!standing) notFound();
  const { track, progress, moduleProgress, badgeLevels } = standing;

  const topicProgress = new Map(progress.map((row) => [row.id, row]));
  const chaptersTotal = progress.reduce((sum, topic) => sum + topic.chapters.length, 0);
  const chaptersDone = progress.reduce((sum, topic) => sum + topic.chaptersDone, 0);
  const modulesBadged = moduleProgress.filter((row) => row.badged).length;

  return (
    <>
      <PageHeader
        title={track.title}
        description={`${chaptersDone} of ${chaptersTotal} chapters · ${modulesBadged} of ${track.modules.length} module badges`}
        action={<HowThisWorks section="track" />}
      />

      <div className="space-y-8">
        {track.modules.map((module, moduleIndex) => {
          const moduleStanding = moduleProgress[moduleIndex];
          return (
            <section key={module.id} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-ink">
                  Module {module.number} · {module.title}
                </h2>
                <div className="flex items-center gap-2 text-xs text-muted">
                  {moduleStanding.badgeLevel ? (
                    <StatusBadge tone="teal">{LEVEL_LABEL[moduleStanding.badgeLevel]}</StatusBadge>
                  ) : null}
                  {moduleStanding.unlocked ? (
                    <span>
                      {moduleStanding.topicsPassed}/{moduleStanding.topicsCounted} topics passed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Lock size={14} aria-label="Locked" />
                      Earn the previous module badge
                    </span>
                  )}
                </div>
              </div>

              {module.topics.map((topic) => {
                const standingHere = topicProgress.get(topic.id)!;
                const level = badgeLevels.get(topic.id);
                if (standingHere.comingSoon) {
                  return (
                    <Card key={topic.id} className="p-5 opacity-70">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <TopicTitle number={topic.number} title={topic.title} />
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                          <Clock size={14} />
                          Coming soon
                        </span>
                      </div>
                    </Card>
                  );
                }
                return (
                  <Card key={topic.id} className={standingHere.unlocked ? "p-5" : "p-5 opacity-70"}>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                      <TopicTitle number={topic.number} title={topic.title} />
                      <div className="flex items-center gap-2 text-xs text-muted">
                        {level ? <StatusBadge tone="teal">{LEVEL_LABEL[level]}</StatusBadge> : null}
                        {standingHere.unlocked ? (
                          <span>
                            {standingHere.chaptersDone}/{topic.chapters.length}
                          </span>
                        ) : (
                          <Lock size={14} aria-label="Locked" />
                        )}
                      </div>
                    </div>

                    <ol className="mt-2 divide-y divide-line/60">
                      {topic.chapters.map((chapter, chapterIndex) => {
                        const state = standingHere.chapters[chapterIndex].state;
                        const row = (
                          <span className="flex items-center gap-3 py-2.5 text-sm">
                            <ChapterStateIcon state={state} />
                            <span className="mono w-12 shrink-0 text-xs text-muted">{chapter.number}</span>
                            <span className={state === "locked" ? "text-muted" : "font-medium text-ink"}>
                              {chapter.title}
                            </span>
                          </span>
                        );
                        return (
                          <li key={chapter.id}>
                            {state === "locked" ? (
                              row
                            ) : (
                              <Link
                                href={chapterHref(track.slug, module.slug, topic.slug, chapter.slug)}
                                className="block hover:text-teal"
                              >
                                {row}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                      <li>
                        {standingHere.testUnlocked ? (
                          <Link
                            href={`/certify/${topic.id}`}
                            className="flex items-center gap-3 py-2.5 text-sm font-semibold text-teal hover:underline"
                          >
                            <Award size={16} />
                            Topic {topic.number} test
                          </Link>
                        ) : (
                          <span className="flex items-center gap-3 py-2.5 text-sm text-muted">
                            <Lock size={16} />
                            Topic {topic.number} test
                          </span>
                        )}
                      </li>
                    </ol>
                  </Card>
                );
              })}

              <Card className={moduleStanding.badged ? "p-4" : "p-4 opacity-70"}>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    <Award size={16} className={moduleStanding.badged ? "text-teal" : "text-muted"} />
                    Module {module.number} badge
                  </span>
                  <span className="text-muted">
                    {moduleStanding.badgeLevel
                      ? `Earned: ${LEVEL_LABEL[moduleStanding.badgeLevel]}`
                      : "Pass every topic test in this module"}
                  </span>
                </div>
              </Card>
            </section>
          );
        })}
      </div>
    </>
  );
}

function TopicTitle({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="mono flex h-8 min-w-10 items-center justify-center rounded bg-navy px-1.5 text-sm font-bold text-white">
        {number}
      </span>
      <h3 className="font-bold text-ink">{title}</h3>
    </div>
  );
}
