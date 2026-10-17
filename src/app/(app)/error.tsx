"use client";

import Link from "next/link";
import { Card } from "@/components/ui";

// Shown inside the app shell (the sidebar stays) when a page or a server
// action throws. Never show error.message: for server errors Next already
// replaces it, but a client-side error's message could still hold data.
// The digest matches the server log line in Vercel.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Card className="max-w-xl p-6">
      <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        This page could not be loaded. If you were saving something, check whether it went through before trying again.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex items-center justify-center rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-ink"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-wash"
        >
          Back to dashboard
        </Link>
      </div>
      {error.digest ? <p className="mono mt-5 text-xs text-muted">Reference: {error.digest}</p> : null}
    </Card>
  );
}
