import type { PlanStatus } from "@prisma/client";

/**
 * Where a plan may go from each status (flags O22). Forward through the
 * life of a plan; a sent plan may be pulled back to draft for changes; any
 * open plan may be closed; a closed plan stays closed.
 */
export const PLAN_TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  DRAFT: ["SENT", "CLOSED"],
  SENT: ["DRAFT", "ACCEPTED", "CLOSED"],
  ACCEPTED: ["ACTIVE", "CLOSED"],
  ACTIVE: ["CLOSED"],
  CLOSED: []
};

/** The statuses a plan's status menu offers: where it is, then where it may go. */
export function planStatusChoices(current: PlanStatus): PlanStatus[] {
  return [current, ...PLAN_TRANSITIONS[current]];
}
