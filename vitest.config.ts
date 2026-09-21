import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./src/*" alias in tsconfig.json.
    alias: { "@": resolve(__dirname, "./src") }
  },
  test: {
    // Node only. No jsdom until there is a component whose behaviour, rather
    // than appearance, is worth asserting.
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      reporter: ["text", "lcov"]
    }
  }
});
