import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The test-engine simulations (flags.md D15). Kept out of `npm test` and CI:
 * they encode expectations about the scoring rules that have not been
 * reviewed yet. Run with `npm run test:sim`.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  test: {
    environment: "node",
    include: ["tests/simulation/**/*.sim.ts"]
  }
});
