import { CheckCircle2, Circle, Lock } from "lucide-react";
import type { ChapterState } from "@/lib/knowledge";

/** The tick, the open circle, or the lock, next to a chapter. */
export function ChapterStateIcon({ state, size = 16 }: { state: ChapterState; size?: number }) {
  if (state === "complete") return <CheckCircle2 size={size} className="shrink-0 text-teal" aria-label="Complete" />;
  if (state === "locked") return <Lock size={size} className="shrink-0 text-muted" aria-label="Locked" />;
  return <Circle size={size} className="shrink-0 text-navy" aria-label="Open" />;
}
