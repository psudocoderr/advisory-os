import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: route handlers and lib code against a real Postgres.
 * Every test starts from empty tables, so the database must be disposable
 * (see tests/integration/setup.ts). Run with `npm run test:integration`.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    // One shared database: files must not truncate under each other.
    fileParallelism: false
  }
});
