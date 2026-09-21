"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type IntegrityKind =
  "FULLSCREEN_EXIT" | "FULLSCREEN_ENTER" | "TAB_HIDDEN" | "WINDOW_BLUR" | "COPY" | "PASTE" | "CONTEXT_MENU";

/**
 * Exam surface: fullscreen, a countdown, and integrity event reporting.
 *
 * What this genuinely does: asks for fullscreen, and reports when the
 * candidate leaves the exam surface so a reviewer can see it afterwards.
 *
 * What it explicitly does not do, because the web platform does not allow it:
 * prevent screenshots, screen recording, a phone camera or a second device.
 * Fullscreen can always be exited -- browsers guarantee Escape works and no
 * page can trap it. Blocking copy and right-click is a speed bump, not a
 * control, since the DOM is readable from devtools regardless.
 *
 * So this is deterrence by record, not prevention. Pretending otherwise would
 * be worse than not having it, because it would be trusted.
 */
export function useExamShell({
  sessionId,
  startedAtMs,
  deadlineMs,
  active,
  onExpire,
  targetRef
}: {
  sessionId: string;
  startedAtMs: number;
  deadlineMs: number;
  active: boolean;
  onExpire: () => void;
  /**
   * The element to make fullscreen. Deliberately not documentElement: that
   * blows the whole application up to full size, sidebar and navigation
   * included, which is the opposite of an exam surface. Fullscreening just the
   * exam container removes the rest of the app from view.
   */
  targetRef: RefObject<HTMLElement | null>;
}) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, deadlineMs - Date.now()));
  const [strikes, setStrikes] = useState(0);
  const [warning, setWarning] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const expiredRef = useRef(false);

  const report = useCallback(
    async (kind: IntegrityKind) => {
      try {
        const response = await fetch("/api/certify/integrity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, kind })
        });
        const payload = await response.json();
        if (typeof payload.strikes === "number") setStrikes(payload.strikes);
      } catch {
        // Never let integrity reporting break the test itself. A candidate
        // must not be blocked by a failed log write.
      }
    },
    [sessionId]
  );

  const requestFullscreen = useCallback(async () => {
    const target = targetRef.current;
    if (!target) return;
    try {
      // Must be called from a user gesture; browsers reject it otherwise.
      await target.requestFullscreen();
    } catch {
      // Denied, or unsupported. The test continues; the absence of fullscreen
      // is itself visible in the event record.
      setWarning("Fullscreen was not granted. This is recorded on your attempt.");
    }
  }, [targetRef]);

  // Countdown. Derived from the server-issued deadline each tick rather than
  // decremented, so a backgrounded tab with throttled timers still shows the
  // right time when it returns. The server enforces expiry regardless.
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const left = Math.max(0, deadlineMs - Date.now());
      setRemainingMs(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, deadlineMs, onExpire]);

  useEffect(() => {
    if (!active) return;

    const onFullscreenChange = () => {
      const now = document.fullscreenElement === targetRef.current;
      setIsFullscreen(now);
      if (now) {
        void report("FULLSCREEN_ENTER");
        setWarning("");
      } else {
        void report("FULLSCREEN_EXIT");
        setWarning("You left fullscreen. This is recorded on your attempt.");
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void report("TAB_HIDDEN");
        setWarning("You switched away from the test. This is recorded on your attempt.");
      }
    };

    const onBlur = () => void report("WINDOW_BLUR");
    const onCopy = () => void report("COPY");
    const onPaste = () => void report("PASTE");
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      void report("CONTEXT_MENU");
    };

    // Sync on mount: a resumed page may already be fullscreen.
    setIsFullscreen(document.fullscreenElement === targetRef.current);

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [active, report, targetRef]);

  // Leave fullscreen once the test is over, so the result is not trapped
  // behind it. Only exits the element this hook put there -- it must not close
  // a fullscreen view the page opened for some other reason.
  useEffect(() => {
    if (active) return;
    const target = targetRef.current;
    if (target && document.fullscreenElement === target) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [active, targetRef]);

  return { remainingMs, strikes, warning, isFullscreen, requestFullscreen, startedAtMs };
}

export function formatRemaining(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
