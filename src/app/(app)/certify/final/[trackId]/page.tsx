import { notFound } from "next/navigation";
import { Award } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { FINAL_EXAM, IRT, LEVEL_LABEL } from "@/lib/irt";
import { loadTrackProgress } from "@/lib/knowledge";
import { prisma } from "@/lib/prisma";
import { Card, HowThisWorks, PageHeader, StatusBadge } from "@/components/ui";
import { StartTestButton } from "@/components/start-test-button";

export default async function FinalExamPage({ params }: { params: Promise<{ trackId: string }> }) {
  const session = await requireSession();
  const { trackId } = await params;
  const standing = await loadTrackProgress({ id: trackId }, session.user);
  if (!standing) notFound();
  const { track, progress, badgeLevels, finalUnlocked, certificateLevel } = standing;

  const questionCount = await prisma.questionItem.count({
    where: { isActive: true, trainingModule: { trackId: track.id } }
  });
  const blocked = !finalUnlocked
    ? "Earn every module badge to unlock"
    : questionCount < FINAL_EXAM.minQuestions
      ? "Not enough questions yet"
      : null;

  return (
    <>
      <PageHeader
        title={`${track.title}: final exam`}
        description="An adaptive test across every module in the track. It awards the track certificate."
        action={<HowThisWorks section="final-exam" />}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Questions" value={`${FINAL_EXAM.minQuestions}–${FINAL_EXAM.maxQuestions}`} />
            <Metric label="Time" value={`${FINAL_EXAM.timeLimitMinutes} min`} />
            <Metric label="Retry after fail" value={`${IRT.cooldownHours} h`} />
          </div>
          {certificateLevel ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink">
              <Award size={16} className="text-teal" />
              Certificate held: <StatusBadge tone="teal">{LEVEL_LABEL[certificateLevel]}</StatusBadge>
            </p>
          ) : null}
          <div className="mt-5">
            <StartTestButton test={{ trackId: track.id }} blocked={blocked} />
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-semibold text-ink">Module badges</h2>
          <div className="space-y-1">
            {track.modules.map((module, index) => {
              const level = badgeLevels.get(module.id);
              return (
                <div key={module.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                  <span className={progress[index].badged ? "text-ink" : "text-muted"}>
                    {index + 1}. {module.title}
                  </span>
                  {level ? (
                    <StatusBadge tone="teal">{LEVEL_LABEL[level]}</StatusBadge>
                  ) : (
                    <StatusBadge>None</StatusBadge>
                  )}
                </div>
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
