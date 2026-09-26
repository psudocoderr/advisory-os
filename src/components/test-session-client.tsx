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

type FinishReason = "STOP_RULE" | "BANK_EXHAUSTED" | "TIMED_OUT" | "INTEGRITY_TERMINATED";

type Result = {
  passed: boolean;
  terminated?: boolean;
  inconclusive?: boolean;
  theta: number;
  se: number;
  level: string;
  reason: FinishReason;
  answered: number;
  remediation: { title: string; href: string; count: number }[];
};

const REASON_NOTE: Record<FinishReason, string> = {
  STOP_RULE: "The estimate reached the required confidence.",
  BANK_EXHAUSTED: "Every available question in this module was answered.",
  TIMED_OUT: "The time limit was reached.",
  INTEGRITY_TERMINATED: "The attempt was ended after repeated integrity violations, and has been flagged for review."
};

export function TestSessionClient({
  sessionId,
  module,
  initialProgress,
  autoFinish,
  deadlineMs
}: {
  sessionId: string;
  module: string;
  initialProgress: Progress;
  /**
   * Server-issued; the browser never decides when time is up. Null until the
   * first question has been released and the clock started.
   */
  deadlineMs: number | null;
  /**
   * Set when the session cannot continue and must be closed on arrival --
   * currently only a bank that has run out. This is what recovers sessions
   * left IN_PROGRESS by the old exhaustion bug, which previously rendered a
   * 404 and had no route back to a finished state.
   */
  autoFinish?: FinishReason;
}) {
  // Never in the page's HTML. Fetched once the server has recorded fullscreen,
  // and dropped again the moment the candidate leaves it.
  const [question, setQuestion] = useState<Question | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const [deadline, setDeadline] = useState(deadlineMs);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const finishRequested = useRef(false);
  const examRef = useRef<HTMLDivElement | null>(null);
  // When each question first appeared, for its response time. Kept per id so
  // leaving and returning to the same question does not reset it.
  const shownAt = useRef<{ id: string; at: number } | null>(null);

  const onExamSurface = () => Boolean(examRef.current) && document.fullscreenElement === examRef.current;

  const showQuestion = useCallback((next: Question) => {
    if (shownAt.current?.id !== next.id) shownAt.current = { id: next.id, at: Date.now() };
    setQuestion(next);
  }, []);

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
        // This browser's clock ran ahead of the server's. Ask again when the
        // server says time is really up.
        if (typeof payload.remainingMs === "number") {
          window.setTimeout(() => void finish(reason), payload.remainingMs + 1000);
          return;
        }
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

  const releaseQuestion = useCallback(async () => {
    if (!onExamSurface()) return;
    setLoadingQuestion(true);
    setError("");
    try {
      const response = await fetch("/api/certify/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || "Unable to load the question.");
        return;
      }
      if (payload.complete) {
        finishRequested.current = true;
        setResult(payload.result);
        return;
      }
      // Left fullscreen while this was in flight. Do not show it; the same
      // question comes back on return.
      if (!onExamSurface()) return;
      setProgress(payload.progress);
      setDeadline(payload.deadlineMs);
      showQuestion(payload.question);
    } catch {
      setError("Unable to load the question. Check your connection and try again.");
    } finally {
      setLoadingQuestion(false);
    }
  }, [sessionId, showQuestion]);

  const handleSurfaceChange = useCallback(
    (onSurface: boolean) => {
      if (onSurface) {
        void releaseQuestion();
      } else {
        setQuestion(null);
        setSelected("");
      }
    },
    [releaseQuestion]
  );

  const handleExpire = useCallback(() => void finish("TIMED_OUT"), [finish]);

  // The server has already closed the session; just show what it decided.
  const handleTerminate = useCallback((payload: unknown) => {
    finishRequested.current = true;
    if (payload) setResult(payload as Result);
  }, []);

  const exam = useExamShell({
    sessionId,
    deadlineMs: deadline,
    active: !result && !autoFinish,
    onExpire: handleExpire,
    onTerminate: handleTerminate,
    onSurfaceChange: handleSurfaceChange,
    targetRef: examRef
  });

  const locked = !question || !exam.isFullscreen;

  function retry() {
    // Re-report the entry in case the first report never reached the server;
    // a repeat is recognised and not written twice.
    void exam.report("FULLSCREEN_ENTER").then(releaseQuestion);
  }

  function submit() {
    if (!question || locked) return;
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
          responseTimeMs: Date.now() - (shownAt.current?.at ?? Date.now())
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.needsFullscreen) {
          setQuestion(null);
          return;
        }
        setError(payload.error || "Unable to submit answer.");
        return;
      }
      setSelected("");
      if (payload.complete) {
        setResult(payload.result);
        return;
      }
      setProgress(payload.progress);
      if (onExamSurface()) showQuestion(payload.question);
      else setQuestion(null);
    });
  }

  if (result) {
    return (
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={result.passed ? "teal" : result.inconclusive ? "amber" : "rose"}>
            {result.terminated
              ? "Attempt terminated"
              : result.passed
                ? "Certified"
                : result.inconclusive
                  ? "Inconclusive"
                  : "Not certified"}
          </StatusBadge>
          <StatusBadge tone="navy">Theta {result.theta.toFixed(2)}</StatusBadge>
          <StatusBadge tone="amber">SE {result.se.toFixed(2)}</StatusBadge>
        </div>
        <h2 className="mt-4 text-xl font-semibold text-ink">{result.level}</h2>
        <p className="mt-1 text-sm text-muted">
          Test ended after {result.answered} question{result.answered === 1 ? "" : "s"}. {REASON_NOTE[result.reason]}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">
          {result.terminated
            ? "This attempt was ended by the system and does not count as a pass. It is recorded on your attempt history and flagged for review."
            : result.passed
              ? `You passed ${module}. Your badge is on the Tests & badges page.`
              : result.inconclusive
                ? "Too close to call: no badge, and nothing on your record. Review these chapters and retake whenever you are ready."
                : "Review these chapters before retrying after the cooldown window."}
        </p>
        {!result.passed && result.remediation.length ? (
          <div className="mt-4 grid gap-2">
            {result.remediation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-teal"
              >
                {item.title}
              </Link>
            ))}
          </div>
        ) : null}
        <Link href="/certify" className="mt-5 inline-flex rounded bg-navy px-3 py-2 text-sm font-semibold text-white">
          Back to tests
        </Link>
      </Card>
    );
  }

  if (autoFinish) {
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
          <StatusBadge tone={deadline !== null && exam.remainingMs <= 60_000 ? "rose" : "navy"}>
            {formatRemaining(exam.remainingMs)} {deadline === null ? "once you begin" : "left"}
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

        {exam.warning ? (
          <div className="mb-4 rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm text-rose">
            {exam.warning}
          </div>
        ) : null}

        {question && !locked ? (
          <div>
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
          </div>
        ) : (
          <div className="relative">
            {/* A stand-in, not the question: the real one is not in the page. */}
            <div aria-hidden className="select-none space-y-4 opacity-40 blur-sm">
              <div className="h-6 w-3/4 rounded bg-line" />
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-12 rounded border border-line bg-wash" />
              ))}
              <div className="h-10 border-t border-line" />
            </div>
            <div className="absolute inset-0 flex items-start justify-center pt-10">
              <div role="alert" className="max-w-md rounded border border-line bg-panel p-5 text-center shadow-soft">
                {!exam.fullscreenSupported ? (
                  <>
                    <h3 className="font-semibold text-ink">This browser cannot run the test</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      The test needs fullscreen, which this browser does not support. Open it in Chrome, Edge, Firefox
                      or Safari on a computer.
                    </p>
                  </>
                ) : !exam.isFullscreen ? (
                  <>
                    <h3 className="font-semibold text-ink">
                      {deadline === null ? "Enter fullscreen to begin" : "Return to fullscreen to continue"}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {deadline === null
                        ? "The first question appears in fullscreen, and the clock starts when it does."
                        : "The question is hidden outside fullscreen, and the clock keeps running. Leaving is recorded on your attempt."}
                    </p>
                    <button
                      onClick={() => void exam.requestFullscreen()}
                      className="mt-4 rounded bg-navy px-4 py-2 text-sm font-semibold text-white"
                    >
                      Enter fullscreen
                    </button>
                  </>
                ) : error ? (
                  <>
                    <p className="text-sm text-rose">{error}</p>
                    <button onClick={retry} className="mt-4 rounded bg-navy px-4 py-2 text-sm font-semibold text-white">
                      Try again
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-muted">{loadingQuestion ? "Loading the question..." : "Preparing..."}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
