import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { deadlineFor, selectNextQuestion } from "@/lib/irt";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { TestSessionClient } from "@/components/test-session-client";

export default async function TestSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireSession();
  const { sessionId } = await params;
  const session = await prisma.testSession.findUnique({
    where: { id: sessionId },
    include: {
      responses: { include: { question: { include: { linkedSop: true } } }, orderBy: { createdAt: "asc" } },
      certification: true
    }
  });
  if (!session || session.userId !== auth.user.id) notFound();

  if (session.status !== "IN_PROGRESS") {
    const incorrect = session.responses.filter((response) => !response.isCorrect);
    const remediation = [
      ...new Map(incorrect.map((row) => [row.question.linkedSop.slug, row.question.linkedSop])).values()
    ].slice(0, 3);
    return (
      <>
        <PageHeader title={`${session.module} Result`} description="Completed adaptive certification attempt." />
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone={session.certified ? "teal" : "rose"}>{session.status}</StatusBadge>
            <StatusBadge tone="navy">Theta {session.abilityEstimate.toFixed(2)}</StatusBadge>
            <StatusBadge tone="amber">SE {session.standardError.toFixed(2)}</StatusBadge>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            {session.certified
              ? `Certification issued at ${session.certification?.level || "Foundation"} level.`
              : "Certification was not issued. Review the linked SOPs before retrying after the cooldown window."}
          </p>
          {!session.certified && remediation.length ? (
            <div className="mt-5 grid gap-2">
              {remediation.map((sop) => (
                <a
                  key={sop.id}
                  href={`/knowledge/${sop.slug}`}
                  className="rounded border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-teal"
                >
                  Review {sop.title}
                </a>
              ))}
            </div>
          ) : null}
        </Card>
      </>
    );
  }

  const bank = await prisma.questionItem.findMany({ where: { module: session.module, isActive: true } });
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
        <PageHeader
          title={`${session.module} Adaptive Test`}
          description="Every available question in this module has been answered."
        />
        <TestSessionClient
          sessionId={session.id}
          module={session.module}
          initialProgress={{
            answered: session.responses.length,
            theta: session.abilityEstimate,
            se: session.standardError
          }}
          startedAtMs={session.startedAt.getTime()}
          deadlineMs={null}
          autoFinish="BANK_EXHAUSTED"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${session.module} Adaptive Test`}
        description="Answer each item from current SOP knowledge. Correct keys are validated on the server only."
      />
      {/*
        No question here. It is fetched from /api/certify/question once the
        server has recorded the candidate entering fullscreen, so it never
        appears in this page's HTML.
      */}
      <TestSessionClient
        sessionId={session.id}
        module={session.module}
        initialProgress={{
          answered: session.responses.length,
          theta: session.abilityEstimate,
          se: session.standardError
        }}
        startedAtMs={session.startedAt.getTime()}
        deadlineMs={session.timerStartedAt ? deadlineFor(session.timerStartedAt).getTime() : null}
      />
    </>
  );
}
