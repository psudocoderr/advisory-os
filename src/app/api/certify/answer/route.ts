import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { certificationLevel, estimateEap, IRT, selectNextQuestion, shouldStop } from "@/lib/irt";
import { prisma } from "@/lib/prisma";

type Option = { key: string; text: string };

const schema = z.object({
  sessionId: z.string(),
  questionId: z.string(),
  selectedKey: z.enum(["A", "B", "C", "D"]),
  responseTimeMs: z.number().int().min(0).max(30 * 60 * 1000)
});

export async function POST(request: Request) {
  const auth = await getServerSession(authOptions);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  const input = parsed.data;

  const testSession = await prisma.testSession.findUnique({
    where: { id: input.sessionId },
    include: { responses: true }
  });
  if (!testSession || testSession.userId !== auth.user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (testSession.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "Session is already complete" }, { status: 400 });
  }
  if (testSession.responses.some((response) => response.questionId === input.questionId)) {
    return NextResponse.json({ error: "Question already answered" }, { status: 409 });
  }

  const [question, bank] = await Promise.all([
    prisma.questionItem.findUnique({ where: { id: input.questionId } }),
    prisma.questionItem.findMany({ where: { module: testSession.module, isActive: true } })
  ]);
  if (!question || question.module !== testSession.module || !question.isActive) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const isCorrect = question.correctKey === input.selectedKey;
  const responseHistory = [...testSession.responses, { questionId: question.id, isCorrect }];
  const estimate = estimateEap(responseHistory, bank);
  const answeredCount = responseHistory.length;

  await prisma.responseLog.create({
    data: {
      sessionId: testSession.id,
      questionId: question.id,
      selectedKey: input.selectedKey,
      isCorrect,
      responseTimeMs: input.responseTimeMs,
      abilityAfter: estimate.theta,
      seAfter: estimate.se
    }
  });

  if (shouldStop(answeredCount, estimate.se)) {
    const passed = estimate.theta >= IRT.passTheta;
    const level = certificationLevel(estimate.theta);
    await prisma.testSession.update({
      where: { id: testSession.id },
      data: {
        abilityEstimate: estimate.theta,
        standardError: estimate.se,
        certified: passed,
        status: passed ? "PASSED" : "FAILED",
        completedAt: new Date()
      }
    });
    await prisma.auditLog.create({
      data: {
        actorId: auth.user.id,
        action: passed ? "PASS" : "FAIL",
        entity: "TestSession",
        entityId: testSession.id,
        summary: `${passed ? "Passed" : "Failed"} ${testSession.module} certification at theta ${estimate.theta.toFixed(2)}`
      }
    });

    if (passed) {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const existing = await prisma.certification.findFirst({
        where: { userId: auth.user.id, module: testSession.module, status: "ACTIVE" }
      });
      if (existing) {
        await prisma.certification.update({
          where: { id: existing.id },
          data: { sessionId: testSession.id, abilityScore: estimate.theta, level, issuedAt: new Date(), expiresAt }
        });
      } else {
        await prisma.certification.create({
          data: {
            userId: auth.user.id,
            module: testSession.module,
            sessionId: testSession.id,
            abilityScore: estimate.theta,
            level,
            expiresAt
          }
        });
      }
    }

    const remediation = passed ? [] : await weakestSops(testSession.id);
    return NextResponse.json({
      complete: true,
      result: {
        passed,
        theta: estimate.theta,
        se: estimate.se,
        level,
        remediation
      }
    });
  }

  await prisma.testSession.update({
    where: { id: testSession.id },
    data: { abilityEstimate: estimate.theta, standardError: estimate.se }
  });

  const usedIds = responseHistory.map((response) => response.questionId);
  const next = selectNextQuestion(estimate.theta, bank, usedIds);
  if (!next) {
    return NextResponse.json({ error: "No remaining questions" }, { status: 500 });
  }

  return NextResponse.json({
    complete: false,
    question: sanitizeQuestion(next),
    progress: {
      answered: answeredCount,
      theta: estimate.theta,
      se: estimate.se
    }
  });
}

function sanitizeQuestion(question: { id: string; content: string; options: unknown }) {
  const options = question.options as Option[];
  return {
    id: question.id,
    content: question.content,
    options: options.map(({ key, text }) => ({ key, text }))
  };
}

async function weakestSops(sessionId: string) {
  const incorrect = await prisma.responseLog.findMany({
    where: { sessionId, isCorrect: false },
    include: { question: { include: { linkedSop: true } } }
  });
  const counts = new Map<string, { title: string; slug: string; count: number }>();
  for (const row of incorrect) {
    const sop = row.question.linkedSop;
    const current = counts.get(sop.id) || { title: sop.title, slug: sop.slug, count: 0 };
    current.count += 1;
    counts.set(sop.id, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
}
