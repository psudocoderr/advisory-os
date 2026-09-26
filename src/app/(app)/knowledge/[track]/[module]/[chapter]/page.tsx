import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Award, CheckCircle2, Lock } from "lucide-react";
import { markChapterComplete } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { chapterHref, loadTrackProgress } from "@/lib/knowledge";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui";
import { ChapterBody } from "@/components/chapter-body";
import { ChapterStateIcon } from "@/components/knowledge";

export default async function ChapterPage({
  params
}: {
  params: Promise<{ track: string; module: string; chapter: string }>;
}) {
  const session = await requireSession();
  const { track: trackSlug, module: moduleSlug, chapter: chapterSlug } = await params;
  const standing = await loadTrackProgress({ slug: trackSlug }, session.user);
  if (!standing) notFound();
  const { track, progress } = standing;

  const moduleIndex = track.modules.findIndex((module) => module.slug === moduleSlug);
  const trainingModule = track.modules[moduleIndex];
  const chapterIndex = trainingModule?.chapters.findIndex((chapter) => chapter.slug === chapterSlug) ?? -1;
  if (chapterIndex < 0) notFound();

  const moduleStanding = progress[moduleIndex];
  const state = moduleStanding.chapters[chapterIndex].state;
  // Enforced on the server: a locked chapter's URL leads back to the contents.
  if (state === "locked") redirect(`/knowledge/${track.slug}`);

  const chapter = await prisma.chapter.findUniqueOrThrow({
    where: { id: trainingModule.chapters[chapterIndex].id },
    select: { id: true, title: true, body: true }
  });

  const href = (index: number) => chapterHref(track.slug, trainingModule.slug, trainingModule.chapters[index].slug);
  const previous = chapterIndex > 0 ? chapterIndex - 1 : null;
  const next = chapterIndex < trainingModule.chapters.length - 1 ? chapterIndex + 1 : null;
  const nextOpen = next !== null && moduleStanding.chapters[next].state !== "locked";

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Link
          href={`/knowledge/${track.slug}`}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-teal"
        >
          <ArrowLeft size={14} />
          {track.title}
        </Link>
        <Card className="p-3">
          <div className="px-2 pb-2 text-xs font-bold uppercase tracking-wide text-muted">
            {moduleIndex + 1}. {trainingModule.title}
          </div>
          <ol>
            {trainingModule.chapters.map((item, index) => {
              const itemState = moduleStanding.chapters[index].state;
              const current = index === chapterIndex;
              const row = (
                <span
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                    current ? "bg-mint font-semibold text-ink" : itemState === "locked" ? "text-muted" : "text-ink"
                  }`}
                >
                  <ChapterStateIcon state={itemState} size={14} />
                  {item.title}
                </span>
              );
              return (
                <li key={item.id}>
                  {itemState === "locked" || current ? (
                    row
                  ) : (
                    <Link href={href(index)} className="block hover:text-teal">
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
            <li className="mt-1 border-t border-line pt-1">
              {moduleStanding.testUnlocked ? (
                <Link
                  href={`/certify/${trainingModule.id}`}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm font-semibold text-teal hover:underline"
                >
                  <Award size={14} />
                  Module test
                </Link>
              ) : (
                <span className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted">
                  <Lock size={14} />
                  Module test
                </span>
              )}
            </li>
          </ol>
        </Card>
      </aside>

      <article>
        <div className="text-xs font-semibold text-muted">
          Chapter {chapterIndex + 1} of {trainingModule.chapters.length}
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{chapter.title}</h1>

        <Card className="mt-5 p-6 sm:p-8">
          <ChapterBody markdown={chapter.body} />
        </Card>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {previous !== null ? (
            <Link
              href={href(previous)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-teal"
            >
              <ArrowLeft size={16} />
              Previous
            </Link>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-3">
            {state === "complete" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal">
                <CheckCircle2 size={16} />
                Completed
              </span>
            ) : (
              <form action={markChapterComplete}>
                <input type="hidden" name="chapterId" value={chapter.id} />
                <button className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-teal">
                  Mark as complete
                </button>
              </form>
            )}
            {next !== null && nextOpen ? (
              <Link
                href={href(next)}
                className="inline-flex items-center gap-1.5 rounded border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-teal"
              >
                Next
                <ArrowRight size={16} />
              </Link>
            ) : null}
            {next === null && moduleStanding.testUnlocked ? (
              <Link
                href={`/certify/${trainingModule.id}`}
                className="inline-flex items-center gap-1.5 rounded border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-teal"
              >
                Module test
                <ArrowRight size={16} />
              </Link>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}
