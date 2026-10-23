import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { csvCell, loadTraineeReport } from "@/lib/trainee-report";

const HEADER = ["Test", "Attempt", "Date", "Status", "Level", "Theta", "SE", "Percent correct", "Questions"];

/** Admin only: one trainee's attempts as CSV, the same rows as /admin/tracker/[userId]. */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await apiSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const report = await loadTraineeReport((await params).userId);
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = report.attempts.map((attempt) => [
    attempt.test,
    attempt.attemptNumber,
    attempt.date.toISOString().slice(0, 10),
    attempt.status,
    attempt.level,
    attempt.theta === null ? null : Number(attempt.theta.toFixed(3)),
    attempt.se === null ? null : Number(attempt.se.toFixed(3)),
    attempt.percentCorrect === null ? null : Number(attempt.percentCorrect.toFixed(1)),
    attempt.answered
  ]);
  const csv = [HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const filename = `${report.user.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trainee"}-tests.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
