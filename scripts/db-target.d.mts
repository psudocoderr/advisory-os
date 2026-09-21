/**
 * Type declarations for scripts/db-target.mjs.
 *
 * The implementation is plain ESM so that the npm scripts (which cannot import
 * TypeScript) and prisma/seed.ts share exactly one copy of the safety checks —
 * two copies of a guard drift apart. This file gives TypeScript callers real
 * types instead of a `@ts-expect-error`, which silently depends on how
 * Prettier happens to wrap the import statement.
 */

export type TargetKind = "local" | "ci" | "deployed" | "unknown";

export interface Target {
  kind: TargetKind;
  host: string | null;
  ci: boolean;
  reason: string;
}

export interface DestructiveOptions {
  operation?: string;
  overrideEnv?: string;
}

export function classifyDatabaseTarget(url: string | undefined): Target;
export function isCi(): boolean;
export function isEphemeral(target: Target): boolean;
export function assertDestructiveAllowed(url: string | undefined, options?: DestructiveOptions): Target;
export function assertPushAllowed(url: string | undefined): Target;
export function findExcessData(counts: Record<string, number>, volumes: Record<string, number>): string[];
