/**
 * Exam integrity policy: what counts as a violation, and how many end the
 * attempt.
 *
 * Shared by the API route that enforces it and the client that displays it, so
 * the number a candidate is warned about is the number they are actually
 * judged by.
 */

export const INTEGRITY_KINDS = [
  "FULLSCREEN_EXIT",
  "FULLSCREEN_ENTER",
  "TAB_HIDDEN",
  "WINDOW_BLUR",
  "COPY",
  "PASTE",
  "CONTEXT_MENU",
  "DEVTOOLS_ATTEMPT"
] as const;

export type IntegrityKind = (typeof INTEGRITY_KINDS)[number];

/**
 * Which events count toward termination.
 *
 * Deliberately not "everything". Two kinds are recorded for the timeline but
 * excluded from the count:
 *
 *   FULLSCREEN_ENTER  the candidate coming back. Penalising a return would be
 *                     perverse.
 *   WINDOW_BLUR       fires alongside TAB_HIDDEN for the same single action,
 *                     so counting both scored one alt-tab as two strikes. It
 *                     also fires for OS notifications and focus steals the
 *                     candidate did not cause.
 *
 * Counting both would end an attempt after two ordinary actions rather than
 * four deliberate ones.
 */
export const STRIKE_KINDS = [
  "FULLSCREEN_EXIT",
  "TAB_HIDDEN",
  "COPY",
  "PASTE",
  "CONTEXT_MENU",
  "DEVTOOLS_ATTEMPT"
] as const satisfies readonly IntegrityKind[];

/** Strictly more than this ends the attempt. The fourth strike terminates. */
export const STRIKE_LIMIT = 3;

/**
 * One action can fire the same event twice — a fullscreen exit that also
 * blurs, a key held down. Repeats of one kind inside this window count once,
 * so a candidate is not charged twice for a single act.
 */
export const DEDUPE_WINDOW_MS = 3000;

/** Whether an event counts toward the strike total. */
export function isStrike(kind: IntegrityKind): boolean {
  return (STRIKE_KINDS as readonly string[]).includes(kind);
}

/** How many strikes remain before the attempt ends. Never negative. */
export function strikesRemaining(strikes: number): number {
  return Math.max(0, STRIKE_LIMIT - strikes);
}

/** Whether this strike total ends the attempt. */
export function shouldTerminate(strikes: number): boolean {
  return strikes > STRIKE_LIMIT;
}

/** The two events that say where the candidate is, rather than what they did. */
export const FULLSCREEN_KINDS = ["FULLSCREEN_ENTER", "FULLSCREEN_EXIT"] as const satisfies readonly IntegrityKind[];

function isFullscreenKind(kind: IntegrityKind): boolean {
  return (FULLSCREEN_KINDS as readonly string[]).includes(kind);
}

/**
 * Whether the candidate is on the exam surface, going by the most recent
 * fullscreen event the server has recorded. No event yet means they have not
 * entered it.
 *
 * Questions are released and answers accepted only while this is true. It is
 * the server's record of what the browser reported, which is as close to the
 * truth as a web page can get: a browser that lies about fullscreen can still
 * get through, but only by forging requests, not by pressing Escape.
 */
export function isOnExamSurface(latestFullscreenKind: IntegrityKind | null | undefined): boolean {
  return latestFullscreenKind === "FULLSCREEN_ENTER";
}

/**
 * Whether an incoming event repeats one already recorded and should not be
 * written again.
 *
 * Fullscreen events are state changes, so they are redundant only if they
 * repeat the current state: an exit after an exit is one exit fired twice,
 * however far apart. A time window would be wrong for them -- leaving and
 * returning within three seconds would drop the return, and the server would
 * go on believing the candidate was outside fullscreen.
 *
 * Everything else collapses repeats of one kind inside DEDUPE_WINDOW_MS.
 */
export function isRedundantEvent(
  kind: IntegrityKind,
  context: {
    latestFullscreenKind: IntegrityKind | null | undefined;
    latestSameKindAt: Date | null | undefined;
    now?: Date;
  }
): boolean {
  if (isFullscreenKind(kind)) return context.latestFullscreenKind === kind;
  if (!context.latestSameKindAt) return false;
  const now = context.now ?? new Date();
  return now.getTime() - context.latestSameKindAt.getTime() < DEDUPE_WINDOW_MS;
}
