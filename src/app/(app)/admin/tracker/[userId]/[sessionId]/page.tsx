import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, titleCase } from "@/lib/format";
import { IRT } from "@/lib/irt";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, TableScroll } from "@/components/ui";

/** One attempt, answer by answer: how theta and SE moved. Admin only. */
export default async function AttemptTrajectoryPage({
  params
}: {
  params: Promise<{ userId: string; sessionId: string }>;
}) {
  await requireAdmin();
  const { userId, sessionId } = await params;
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: {
      user: { select: { name: true } },
      module: { select: { title: true } },
      track: { select: { title: true } },
      responses: {
        orderBy: { createdAt: "asc" },
        include: { question: { select: { content: true } } }
      }
    }
  });
  if (!session || session.userId !== userId) notFound();
  const label = session.module?.title ?? `${session.track.title} final exam`;

  return (
    <>
      <PageHeader
        title={`${session.user.name}: ${label}`}
        description={`Attempt ${session.attemptNumber}, ${dateLabel(session.startedAt)}, ${titleCase(session.status)}. Theta and SE after each answer.`}
      />
      {session.responses.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No answers recorded.</Card>
      ) : (
        <>
          <Card className="p-4">
            <Trajectory
              points={session.responses.map((r) => ({ theta: r.abilityAfter, se: r.seAfter, correct: r.isCorrect }))}
            />
          </Card>
          <Card className="mt-5 overflow-hidden">
            <TableScroll>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Question</th>
                    <th className="px-4 py-3">Answer</th>
                    <th className="px-4 py-3">Theta</th>
                    <th className="px-4 py-3">SE</th>
                    <th className="px-4 py-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {session.responses.map((response, index) => (
                    <tr key={response.id}>
                      <td className="mono px-4 py-3">{index + 1}</td>
                      <td className="max-w-md truncate px-4 py-3" title={response.question.content}>
                        {response.question.content}
                      </td>
                      <td className="px-4 py-3">{response.isCorrect ? "Correct" : "Wrong"}</td>
                      <td className="mono px-4 py-3">{response.abilityAfter.toFixed(2)}</td>
                      <td className="mono px-4 py-3">{response.seAfter.toFixed(2)}</td>
                      <td className="mono px-4 py-3">{(response.responseTimeMs / 1000).toFixed(0)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </>
      )}
      <Link
        href={`/admin/tracker/${userId}`}
        className="mt-5 inline-block text-xs font-semibold text-muted hover:text-teal"
      >
        ← {session.user.name}
      </Link>
    </>
  );
}

type Point = { theta: number; se: number; correct: boolean };

const W = 640;
const H = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 36 };

/** Theta after each answer, with a ±1 SE band and the pass line. Filled dot = correct, hollow = wrong. */
function Trajectory({ points }: { points: Point[] }) {
  // The first estimates carry a wide SE; clamp so the band doesn't flatten the line.
  const clamp = (v: number) => Math.max(-4, Math.min(4, v));
  const lo = Math.floor(Math.min(IRT.passTheta, ...points.map((p) => clamp(p.theta - p.se))));
  const hi = Math.ceil(Math.max(IRT.passTheta, ...points.map((p) => clamp(p.theta + p.se))));
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? 0.5 : i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((hi - clamp(v)) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.theta)}`).join("");
  const band =
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.theta + p.se)}`).join("") +
    points
      .map((p, i) => [i, p] as const)
      .reverse()
      .map(([i, p]) => `L${x(i)},${y(p.theta - p.se)}`)
      .join("") +
    "Z";
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const xStep = Math.max(1, Math.ceil(points.length / 10));

  return (
    <figure>
      <figcaption className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
        Theta after each answer (band: ±1 SE)
      </figcaption>
      {/* Scrolls inside the card on a phone rather than shrinking the labels to nothing. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label="Theta after each answer"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px]">
                {t}
              </text>
            </g>
          ))}
          <path d={band} className="fill-teal/15" />
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(IRT.passTheta)}
            y2={y(IRT.passTheta)}
            className="stroke-muted"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text x={W - PAD.right} y={y(IRT.passTheta) - 4} textAnchor="end" className="fill-muted text-[10px]">
            Pass {IRT.passTheta}
          </text>
          <path d={line} fill="none" className="stroke-teal" strokeWidth={2} strokeLinejoin="round" />
          {points.map((p, i) => (
            <g key={i}>
              <circle
                cx={x(i)}
                cy={y(p.theta)}
                r={4}
                strokeWidth={2}
                className={p.correct ? "fill-teal stroke-white" : "fill-white stroke-teal"}
              />
              <circle cx={x(i)} cy={y(p.theta)} r={10} fill="transparent">
                <title>
                  {`Q${i + 1} ${p.correct ? "correct" : "wrong"}: theta ${p.theta.toFixed(2)}, SE ${p.se.toFixed(2)}`}
                </title>
              </circle>
              {i % xStep === 0 || i === points.length - 1 ? (
                <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[10px]">
                  {i + 1}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
