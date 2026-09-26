import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { LEVEL_LABEL } from "@/lib/irt";
import { chapterHref, loadTrackProgress } from "@/lib/knowledge";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { ChapterStateIcon } from "@/components/knowledge";

export default async function TrackPage({ params }: { params: Promise<{ track: string }> }) {
  const session = await requireSession();
  const { track: slug } = await params;
  const standing = await loadTrackProgress({ slug }, session.user);
  if (!standing) notFound();
  const { track, progress, badgeLevels } = standing;

  const chaptersTotal = progress.reduce((sum, module) => sum + module.chapters.length, 0);
  const chaptersDone = progress.reduce((sum, module) => sum + module.chaptersDone, 0);
  const badges = progress.filter((module) => module.badged).length;

  return (
    <>
      <PageHeader
        title={track.title}
        description={`${chaptersDone} of ${chaptersTotal} chapters · ${badges} of ${track.modules.length} badges`}
      />

      <div className="space-y-4">
        {track.modules.map((module, index) => {
          const standingHere = progress[index];
          const level = badgeLevels.get(module.id);
          return (
            <Card key={module.id} className={standingHere.unlocked ? "p-5" : "p-5 opacity-70"}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-navy text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <h2 className="font-bold text-ink">{module.title}</h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  {level ? <StatusBadge tone="teal">{LEVEL_LABEL[level]}</StatusBadge> : null}
                  {standingHere.unlocked ? (
                    <span>
                      {standingHere.chaptersDone}/{module.chapters.length}
                    </span>
                  ) : (
                    <Lock size={14} aria-label="Locked" />
                  )}
                </div>
              </div>

              <ol className="mt-2 divide-y divide-line/60">
                {module.chapters.map((chapter, chapterIndex) => {
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
                          href={chapterHref(track.slug, module.slug, chapter.slug)}
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
                      href={`/certify/${module.id}`}
                      className="flex items-center gap-3 py-2.5 text-sm font-semibold text-teal hover:underline"
                    >
                      <Award size={16} />
                      Module test
                    </Link>
                  ) : (
                    <span className="flex items-center gap-3 py-2.5 text-sm text-muted">
                      <Lock size={16} />
                      Module test
                    </span>
                  )}
                </li>
              </ol>
            </Card>
          );
        })}
      </div>
    </>
  );
}
