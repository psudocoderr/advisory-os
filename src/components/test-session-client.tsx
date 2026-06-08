"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, StatusBadge } from "@/components/ui";

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

type Result = {
  passed: boolean;
  theta: number;
  se: number;
  level: string;
  remediation: { title: string; slug: string; count: number }[];
};

export function TestSessionClient({
  sessionId,
  module,
  initialQuestion,
  initialProgress
}: {
  sessionId: string;
  module: string;
  initialQuestion: Question;
  initialProgress: Progress;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [progress, setProgress] = useState(initialProgress);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [pending, startTransition] = useTransition();

  function submit() {
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
          <StatusBadge tone={result.passed ? "teal" : "rose"}>{result.passed ? "Certified" : "Not certified"}</StatusBadge>
          <StatusBadge tone="navy">Theta {result.theta.toFixed(2)}</StatusBadge>
          <StatusBadge tone="amber">SE {result.se.toFixed(2)}</StatusBadge>
        </div>
        <h2 className="mt-4 text-xl font-semibold text-ink">{result.level}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {result.passed
            ? `You passed ${module}. The credential is now visible on the certification dashboard.`
            : "Review the weakest linked SOPs before retrying after the cooldown window."}
        </p>
        {!result.passed && result.remediation.length ? (
          <div className="mt-4 grid gap-2">
            {result.remediation.map((item) => (
              <Link key={item.slug} href={`/knowledge/${item.slug}`} className="rounded border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-teal">
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

  return (
    <Card className="p-5">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <StatusBadge tone="navy">Answered {progress.answered}</StatusBadge>
        <StatusBadge tone="teal">Theta {progress.theta.toFixed(2)}</StatusBadge>
        <StatusBadge tone="amber">SE {progress.se === 99 ? "..." : progress.se.toFixed(2)}</StatusBadge>
      </div>
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
            <span><strong>{option.key}.</strong> {option.text}</span>
          </label>
        ))}
      </div>
      {error ? <div className="mt-4 rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm text-rose">{error}</div> : null}
      <button onClick={submit} disabled={pending} className="mt-5 rounded bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Submitting..." : "Submit answer"}
      </button>
    </Card>
  );
}
