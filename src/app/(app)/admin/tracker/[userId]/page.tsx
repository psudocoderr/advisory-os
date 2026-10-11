import Link from "next/link";
import { notFound } from "next/navigation";
import type { TestSessionStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, titleCase } from "@/lib/format";
import { loadTraineeReport } from "@/lib/trainee-report";
import { Card, EmptyState, PageHeader, StatusBadge, TableScroll } from "@/components/ui";

const STATUS_TONE: Record<TestSessionStatus, "teal" | "rose" | "amber" | "navy" | "slate"> = {
  PASSED: "teal",
  FAILED: "rose",
  TERMINATED: "rose",
  INCONCLUSIVE: "amber",
  IN_PROGRESS: "navy",
  ABANDONED: "slate"
};

const fixed = (value: number | null, digits: number, suffix = "") =>
  value === null ? "—" : `${value.toFixed(digits)}${suffix}`;

/** Every test attempt by one trainee, with the ability estimates trainees never see. */
export default async function TraineeReportPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireAdmin();
  const { userId } = await params;
  const report = await loadTraineeReport(userId);
  if (!report) notFound();
  const { user, attempts } = report;

  return (
    <>
      <PageHeader
        title={user.name}
        description={`${user.email}: every test attempt, newest first.`}
        action={
          attempts.length ? (
            <a
              href={`/api/reports/${userId}`}
              className="rounded border border-line bg-panel px-3 py-2 text-sm font-semibold text-ink hover:bg-wash"
            >
              Download CSV
            </a>
          ) : null
        }
      />
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
                {attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="px-4 py-3 font-semibold text-ink">
                      {attempt.answered ? (
                        <Link href={`/admin/tracker/${userId}/${attempt.id}`} className="hover:text-teal">
                          {attempt.test}
                        </Link>
                      ) : (
                        attempt.test
                      )}
                    </td>
                    <td className="mono px-4 py-3">{attempt.attemptNumber}</td>
                    <td className="px-4 py-3 text-muted">{dateLabel(attempt.date)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={STATUS_TONE[attempt.status]}>{titleCase(attempt.status)}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">{attempt.level ?? "—"}</td>
                    <td className="mono px-4 py-3">{fixed(attempt.theta, 2)}</td>
                    <td className="mono px-4 py-3">{fixed(attempt.se, 2)}</td>
                    <td className="mono px-4 py-3">{fixed(attempt.percentCorrect, 0, "%")}</td>
                    <td className="mono px-4 py-3">{attempt.answered}</td>
                  </tr>
                ))}
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
