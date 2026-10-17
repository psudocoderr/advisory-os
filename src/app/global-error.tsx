"use client";

// Last resort, used only when the root layout itself fails. It replaces the
// whole document, so it brings its own <html>/<body> and plain inline styles
// (no providers, no app CSS). Never show error.message; the digest matches the
// server log line in Vercel.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f5f7fb", color: "#172033" }}>
        <title>Something went wrong · Advisory OS</title>
        <main style={{ maxWidth: "32rem", margin: "15vh auto", padding: "0 16px" }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "#64748b" }}>
            Advisory OS could not load. If you were saving something, check whether it went through before trying again.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: "#172033",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "8px 12px",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#64748b", marginTop: 20 }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
