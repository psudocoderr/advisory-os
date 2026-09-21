"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Card, StatusBadge } from "@/components/ui";
import { formatRemaining, useExamShell } from "@/components/exam-shell";

type Question = {
  id: string;
  content: string;
  options: { key: string; text: string }[];
};

type Progress = {
  answered: number;
  theta: number;
  se: number;
};

type FinishReason = "STOP_RULE" | "BANK_EXHAUSTED" | "TIMED_OUT";

type Result = {
  passed: boolean;
  theta: number;
  se: number;
  level: string;
  reason: FinishReason;
  answered: number;
  remediation: { title: string; slug: string; count: number }[];
};

const REASON_NOTE: Record<FinishReason, string> = {
  STOP_RULE: "The estimate reached the required confidence.",
  BANK_EXHAUSTED: "Every available question in this module was answered.",
  TIMED_OUT: "The time limit was reached."
};

export function TestSessionClient({
  sessionId,
  module,
  initialQuestion,
  initialProgress,
  autoFinish,
  startedAtMs,
  deadlineMs
}: {
  sessionId: string;
  module: string;
  initialQuestion: Question | null;
  initialProgress: Progress;
  /** Server-issued. The browser never decides when time is up. */
  startedAtMs: number;
  deadlineMs: number;
  /**
   * Set when the session cannot continue and must be closed on arrival --
   * currently only a bank that has run out. This is what recovers sessions
   * left IN_PROGRESS by the old exhaustion bug, which previously rendered a
   * 404 and had no route back to a finished state.
   */
  autoFinish?: FinishReason;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [progress, setProgress] = useState(initialProgress);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [pending, startTransition] = useTransition();
  const finishRequested = useRef(false);

  const finish = useCallback(
    async (reason: FinishReason) => {
      // The client decides when to finish. The server recomputes the score
      // from stored responses and decides everything else.
      if (finishRequested.current) return;
      finishRequested.current = true;

      const response = await fetch("/api/certify/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reason })
      });
      const payload = await response.json();
      if (!response.ok) {
        finishRequested.current = false;
        setError(payload.error || "Unable to close this test.");
        return;
      }
      setResult(payload.result);
    },
    [sessionId]
  );

  useEffect(() => {
    if (autoFinish) void finish(autoFinish);
  }, [autoFinish, finish]);

  const handleExpire = useCallback(() => void finish("TIMED_OUT"), [finish]);

  const examRef = useRef<HTMLDivElement | null>(null);

  const exam = useExamShell({
    sessionId,
    startedAtMs,
    deadlineMs,
    active: !result && Boolean(question),
    onExpire: handleExpire,
    targetRef: examRef
  });

  function submit() {
    if (!question) return;
    if (!selected) {
      setError("Choose an option before submitting.");
      return;
    }
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/certify/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          questionId: question.id,
          selectedKey: selected,
          responseTimeMs: Date.now() - startedAt
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Unable to submit answer.");
        return;
      }
      setSelected("");
      if (payload.complete) {
        setResult(payload.result);
      } else {
        setQuestion(payload.question);
        setProgress(payload.progress);
        setStartedAt(Date.now());
      }
    });
  }

  if (result) {
    return (
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={result.passed ? "teal" : "rose"}>
            {result.passed ? "Certified" : "Not certified"}
          </StatusBadge>
          <StatusBadge tone="navy">Theta {result.theta.toFixed(2)}</StatusBadge>
          <StatusBadge tone="amber">SE {result.se.toFixed(2)}</StatusBadge>
        </div>
        <h2 className="mt-4 text-xl font-semibold text-ink">{result.level}</h2>
        <p className="mt-1 text-sm text-muted">
          Test ended after {result.answered} question{result.answered === 1 ? "" : "s"}. {REASON_NOTE[result.reason]}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">
          {result.passed
            ? `You passed ${module}. The credential is now visible on the certification dashboard.`
            : "Review the weakest linked SOPs before retrying after the cooldown window."}
        </p>
        {!result.passed && result.remediation.length ? (
          <div className="mt-4 grid gap-2">
            {result.remediation.map((item) => (
              <Link
                key={item.slug}
                href={`/knowledge/${item.slug}`}
                className="rounded border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-teal"
              >
                {item.title}
              </Link>
            ))}
          </div>
        ) : null}
        <Link href="/certify" className="mt-5 inline-flex rounded bg-navy px-3 py-2 text-sm font-semibold text-white">
          Back to certification
        </Link>
      </Card>
    );
  }

  if (!question) {
    return (
      <Card className="p-5">
        <p className="text-sm text-muted">Closing this test...</p>
        {error ? (
          <div className="mt-4 rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm text-rose">{error}</div>
        ) : null}
      </Card>
    );
  }

  return (
    <div ref={examRef} className="exam-surface">
      <Card className="p-5">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <StatusBadge tone={exam.remainingMs <= 60_000 ? "rose" : "navy"}>
            {formatRemaining(exam.remainingMs)} left
          </StatusBadge>
          <StatusBadge tone="navy">Answered {progress.answered}</StatusBadge>
          <StatusBadge tone="teal">Theta {progress.theta.toFixed(2)}</StatusBadge>
          <StatusBadge tone="amber">SE {progress.se === 99 ? "..." : progress.se.toFixed(2)}</StatusBadge>
          {exam.strikes > 0 ? (
            <StatusBadge tone="rose">
              {exam.strikes} integrity event{exam.strikes === 1 ? "" : "s"}
            </StatusBadge>
          ) : null}
        </div>

        {!exam.isFullscreen ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-amber/30 bg-amber/10 px-3 py-2">
            <p className="text-sm text-ink">
              This test is meant to be taken in fullscreen. Leaving it is recorded on your attempt.
            </p>
            <button
              onClick={() => void exam.requestFullscreen()}
              className="rounded bg-navy px-3 py-1.5 text-sm font-semibold text-white"
            >
              Enter fullscreen
            </button>
          </div>
        ) : null}

        {exam.warning ? (
          <div className="mb-4 rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm text-rose">
            {exam.warning}
          </div>
        ) : null}
        <h2 className="text-lg font-semibold leading-7 text-ink">{question.content}</h2>
        <div className="mt-5 grid gap-3">
          {question.options.map((option) => (
            <label
              key={option.key}
              className={`flex items-start gap-3 rounded border p-3 text-sm ${
                selected === option.key ? "border-teal bg-mint" : "border-line bg-wash"
              }`}
            >
              <input
                type="radio"
                name="answer"
                value={option.key}
                checked={selected === option.key}
                onChange={() => setSelected(option.key)}
                className="mt-1"
              />
              <span>
                <strong>{option.key}.</strong> {option.text}
              </span>
            </label>
          ))}
        </div>
        {error ? (
          <div className="mt-4 rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm text-rose">{error}</div>
        ) : null}
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-4">
          <p className="text-xs text-muted">
            {selected ? `Option ${selected} selected` : "Select an option to continue"}
          </p>
          <button
            onClick={submit}
            disabled={pending || !selected}
            className="rounded bg-navy px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Submitting..." : "Submit answer"}
          </button>
        </div>
      </Card>
    </div>
  );
}
