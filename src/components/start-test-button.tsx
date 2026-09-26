"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";

/** `blocked` is the reason the test cannot start yet, shown on the button. */
export function StartTestButton({ moduleId, blocked }: { moduleId: string; blocked: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <div>
      <button
        disabled={blocked !== null || pending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const response = await fetch("/api/certify/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moduleId })
            });
            const payload = await response.json();
            if (!response.ok) {
              setError(payload.error || "Unable to start test.");
              return;
            }
            router.push(`/certify/session/${payload.sessionId}`);
          });
        }}
        className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Starting..." : (blocked ?? "Start test")}
      </button>
      {error ? (
        <div className="mt-3 rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm text-rose">{error}</div>
      ) : null}
    </div>
  );
}
