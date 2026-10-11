import Link from "next/link";
import { notFound } from "next/navigation";
import type { TestSessionStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, titleCase } from "@/lib/format";
import { decide, LEVEL_LABEL } from "@/lib/irt";
import { prisma } from "@/lib/prisma";
import { Card, EmptyState, PageHeader, StatusBadge, TableScroll } from "@/components/ui";

const STATUS_TONE: Record<TestSessionStatus, "teal" | "rose" | "amber" | "navy" | "slate"> = {
  PASSED: "teal",
  FAILED: "rose",
  TERMINATED: "rose",
  INCONCLUSIVE: "amber",
  IN_PROGRESS: "navy",
  ABANDONED: "slate"
};

/** Every test attempt by one trainee, with the ability estimates trainees never see. */
export default async function TraineeReportPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireAdmin();
  const { userId } = await params;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!user) notFound();

  const attempts = await prisma.testSession.findMany({
    where: { userId },
    include: {
      module: { select: { title: true } },
      track: { select: { title: true } },
      responses: { select: { isCorrect: true } }
    },
    orderBy: { startedAt: "desc" }
  });

  return (
    <>
      <PageHeader title={user.name} description={`${user.email}: every test attempt, newest first.`} />
      {attempts.length === 0 ? (
        <EmptyState title="No attempts yet" body="This trainee has not started a test." />
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Test</th>
                  <th className="px-4 py-3">Attempt</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Level</th>
                  <th className="px-4 py-3">Theta</th>
                  <th className="px-4 py-3">SE</th>
                  <th className="px-4 py-3">Correct</th>
                  <th className="px-4 py-3">Questions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {attempts.map((attempt) => {
                  const answered = attempt.responses.length;
                  const percent = answered ? (100 * attempt.responses.filter((r) => r.isCorrect).length) / answered : 0;
                  // Recomputed per attempt, as on the result page: a retake can
                  // pass below the badge already held.
                  const decision = attempt.certified
                    ? decide(attempt.abilityEstimate, attempt.standardError, percent)
                    : null;
                  return (
                    <tr key={attempt.id}>
                      <td className="px-4 py-3 font-semibold text-ink">
                        {attempt.module?.title ?? `${attempt.track.title} final exam`}
                      </td>
                      <td className="mono px-4 py-3">{attempt.attemptNumber}</td>
                      <td className="px-4 py-3 text-muted">{dateLabel(attempt.completedAt ?? attempt.startedAt)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={STATUS_TONE[attempt.status]}>{titleCase(attempt.status)}</StatusBadge>
                      </td>
                      <td className="px-4 py-3">{decision?.outcome === "PASS" ? LEVEL_LABEL[decision.level] : "—"}</td>
                      <td className="mono px-4 py-3">{answered ? attempt.abilityEstimate.toFixed(2) : "—"}</td>
                      <td className="mono px-4 py-3">{answered ? attempt.standardError.toFixed(2) : "—"}</td>
                      <td className="mono px-4 py-3">{answered ? `${percent.toFixed(0)}%` : "—"}</td>
                      <td className="mono px-4 py-3">{answered}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
      <Link href="/admin/tracker" className="mt-5 inline-block text-xs font-semibold text-muted hover:text-teal">
        ← Trainee tracker
      </Link>
    </>
  );
}
