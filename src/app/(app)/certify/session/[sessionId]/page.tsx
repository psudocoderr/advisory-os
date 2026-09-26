import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { decide, deadlineFor, LEVEL_LABEL, selectNextQuestion } from "@/lib/irt";
import { questionBank, sessionPercentCorrect, weakestChapters } from "@/lib/certify-session";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { TestSessionClient } from "@/components/test-session-client";

export default async function TestSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireSession();
  const { sessionId } = await params;
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: {
      trainingModule: { select: { title: true } },
      track: { select: { title: true } },
      responses: { select: { questionId: true } }
    }
  });
  if (!session || session.userId !== auth.user.id) notFound();
  const label = session.trainingModule?.title ?? session.track?.title ?? "Test";

  if (session.status !== "IN_PROGRESS") {
    const remediation = session.certified ? [] : await weakestChapters(session.id);
    // From the attempt itself, not the badge row: a retake that scores lower
    // than the badge already held passes without replacing it.
    const percentCorrect = await sessionPercentCorrect(session.id);
    const decision = decide(session.abilityEstimate, session.standardError, percentCorrect);
    const level = decision.outcome === "PASS" ? decision.level : null;
    return (
      <>
        <PageHeader title={`${label}: result`} description="Completed adaptive certification attempt." />
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={session.certified ? "teal" : session.status === "INCONCLUSIVE" ? "amber" : "rose"}>
              {session.status}
            </StatusBadge>
            <StatusBadge tone="navy">Theta {session.abilityEstimate.toFixed(2)}</StatusBadge>
            <StatusBadge tone="amber">SE {session.standardError.toFixed(2)}</StatusBadge>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            {session.certified
              ? `Passed at ${level ? LEVEL_LABEL[level] : "—"} level, ${percentCorrect.toFixed(0)}% correct. The best level you have reached stands.`
              : session.status === "INCONCLUSIVE"
                ? "Too close to call: no badge, and nothing on your record. Review these chapters and retake whenever you are ready."
                : "No badge this time. Review these chapters before retrying after the cooldown window."}
          </p>
          {!session.certified && remediation.length ? (
            <div className="mt-5 grid gap-2">
              {remediation.map((chapter) => (
                <a
                  key={chapter.href}
                  href={chapter.href}
                  className="rounded border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-teal"
                >
                  Review {chapter.title}
                </a>
              ))}
            </div>
          ) : null}
        </Card>
      </>
    );
  }

  const bank = await questionBank(session);
  const next = selectNextQuestion(
    session.abilityEstimate,
    bank,
    session.responses.map((response) => response.questionId)
  );
  // An exhausted bank is a finished test, not a missing page. Returning 404
  // here is what made the old exhaustion bug unrecoverable: the start route
  // resumes an IN_PROGRESS session, and this page then refused to render it.
  // Hand it to the client, which closes it out and shows the result.
  if (!next) {
    return (
      <>
        <PageHeader title={`${label}: test`} description="Every available question in this module has been answered." />
        <TestSessionClient
          sessionId={session.id}
          module={label}
          initialProgress={{
            answered: session.responses.length,
            theta: session.abilityEstimate,
            se: session.standardError
          }}
          deadlineMs={null}
          autoFinish="BANK_EXHAUSTED"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={`${label}: test`} description="Answer each question. Answers are checked on the server." />
      {/*
        No question here. It is fetched from /api/certify/question once the
        server has recorded the candidate entering fullscreen, so it never
        appears in this page's HTML.
      */}
      <TestSessionClient
        sessionId={session.id}
        module={label}
        initialProgress={{
          answered: session.responses.length,
          theta: session.abilityEstimate,
          se: session.standardError
        }}
        deadlineMs={session.timerStartedAt ? deadlineFor(session.timerStartedAt).getTime() : null}
      />
    </>
  );
}
