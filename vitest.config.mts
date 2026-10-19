import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Two projects, one coverage number:
 *   unit         no database; `npm test`, the fast CI job.
 *   integration  a real Postgres (vitest.integration.config.mts); `npm run test:integration`.
 * `npm run test:coverage` runs both (it needs the database) and enforces the
 * thresholds. Ratchet: raise them when coverage rises, never lower them
 * (docs/engineering/codebase-guide.md).
 */
export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./src/*" alias in tsconfig.json.
    alias: { "@": resolve(import.meta.dirname, "./src") }
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // Node only. No jsdom until there is a component whose behaviour, rather
          // than appearance, is worth asserting.
          environment: "node",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/integration/**"]
        }
      },
      "./vitest.integration.config.mts"
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**"],
      reporter: ["text-summary", "lcov"],
      // Measured 2026-10-19 (unit + integration), rounded down.
      thresholds: { statements: 60, branches: 63, functions: 62, lines: 61 }
    }
  }
});
