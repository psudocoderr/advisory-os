import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, Lock } from "lucide-react";
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
  const { track, progress, badgeLevels, finalUnlocked, certificateLevel } = standing;

  const chaptersTotal = progress.reduce((sum, topic) => sum + topic.chapters.length, 0);
  const chaptersDone = progress.reduce((sum, topic) => sum + topic.chaptersDone, 0);
  const badges = progress.filter((topic) => topic.badged).length;
  // Topics are numbered and unlocked in one sequence across the track.
  const position = new Map(track.topics.map((topic, index) => [topic.id, index]));

  return (
    <>
      <PageHeader
        title={track.title}
        description={`${chaptersDone} of ${chaptersTotal} chapters · ${badges} of ${track.topics.length} badges${certificateLevel ? " · certified" : ""}`}
        action={<HowThisWorks section="track" />}
      />

      <div className="space-y-4">
        {track.modules.map((module) => (
          <section key={module.id} className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted">{module.title}</h2>
            {module.topics.map((topic) => {
              const index = position.get(topic.id)!;
              const standingHere = progress[index];
              const level = badgeLevels.get(topic.id);
              return (
                <Card key={topic.id} className={standingHere.unlocked ? "p-5" : "p-5 opacity-70"}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-navy text-sm font-bold text-white">
                        {index + 1}
                      </span>
                      <h3 className="font-bold text-ink">{topic.title}</h3>
                    </div>
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
                          Topic test
                        </Link>
                      ) : (
                        <span className="flex items-center gap-3 py-2.5 text-sm text-muted">
                          <Lock size={16} />
                          Topic test
                        </span>
                      )}
                    </li>
                  </ol>
                </Card>
              );
            })}
          </section>
        ))}
        <Card className={finalUnlocked ? "p-5" : "p-5 opacity-70"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded bg-navy text-white">
                <Award size={16} />
              </span>
              <h2 className="font-bold text-ink">Final exam</h2>
              {certificateLevel ? <StatusBadge tone="teal">{LEVEL_LABEL[certificateLevel]}</StatusBadge> : null}
            </div>
            {finalUnlocked ? (
              <Link href={`/certify/final/${track.id}`} className="text-sm font-semibold text-teal hover:underline">
                {certificateLevel ? "Retake" : "Take the final exam"}
              </Link>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <Lock size={14} aria-label="Locked" />
                Earn every topic badge
              </span>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
