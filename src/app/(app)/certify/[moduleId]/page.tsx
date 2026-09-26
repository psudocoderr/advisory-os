import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { IRT } from "@/lib/irt";
import { chapterHref, loadTrackProgress } from "@/lib/knowledge";
import { prisma } from "@/lib/prisma";
import { MINIMUM_BANK_SIZE } from "@/lib/question-bank";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { ChapterStateIcon } from "@/components/knowledge";
import { StartTestButton } from "@/components/start-test-button";

export default async function ModuleTestPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const session = await requireSession();
  const { moduleId } = await params;
  const trainingModule = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!trainingModule) notFound();

  const [standing, questionCount] = await Promise.all([
    loadTrackProgress({ id: trainingModule.trackId }, session.user),
    prisma.questionItem.count({ where: { moduleId, isActive: true } })
  ]);
  if (!standing) notFound();
  const index = standing.track.modules.findIndex((module) => module.id === moduleId);
  const loaded = standing.track.modules[index];
  const moduleStanding = standing.progress[index];

  const blocked = !moduleStanding.testUnlocked
    ? "Complete every chapter to unlock"
    : questionCount < MINIMUM_BANK_SIZE
      ? "Not enough questions yet"
      : null;

  return (
    <>
      <PageHeader title={`${trainingModule.title}: module test`} description="An adaptive test. It awards a badge." />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Questions" value={`${IRT.minQuestions}–${IRT.maxQuestions}`} />
            <Metric label="Time" value={`${IRT.timeLimitMinutes} min`} />
            <Metric label="Retry after fail" value={`${IRT.cooldownHours} h`} />
          </div>
          <div className="mt-5">
            <StartTestButton moduleId={moduleId} blocked={blocked} />
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-ink">Chapters</h2>
            <StatusBadge tone={moduleStanding.testUnlocked ? "teal" : "slate"}>
              {moduleStanding.chaptersDone}/{loaded.chapters.length}
            </StatusBadge>
          </div>
          <div className="space-y-1">
            {loaded.chapters.map((chapter, chapterIndex) => {
              const state = moduleStanding.chapters[chapterIndex].state;
              const row = (
                <span className="flex items-center gap-2 rounded px-2 py-1.5 text-sm">
                  <ChapterStateIcon state={state} size={14} />
                  {chapter.title}
                </span>
              );
              return state === "locked" ? (
                <div key={chapter.id} className="text-muted">
                  {row}
                </div>
              ) : (
                <Link
                  key={chapter.id}
                  href={chapterHref(standing.track.slug, loaded.slug, chapter.slug)}
                  className="block text-ink hover:text-teal"
                >
                  {row}
                </Link>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-wash p-3">
      <div className="mono text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
