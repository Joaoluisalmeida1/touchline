import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside the react-server condition; tests import server modules directly.
      "server-only": path.resolve(import.meta.dirname, "tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // only show console output (e.g. matchday JSON logs) for failing tests
    silent: "passed-only",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        // real Postgres (LOCAL_PG_URL); each suite creates its own database, run them one at a time
        test: { name: "integration", include: ["tests/integration/**/*.test.ts"], fileParallelism: false },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.ts", "src/app/**/*.tsx", "src/components/**"],
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      // Enforced on the full run (unit + integration, `npm run test:coverage`). Set a few points below the measured
      // values; raise them as coverage grows, never lower them to make a PR pass.
      thresholds: {
        lines: 80,
        statements: 78,
        functions: 78,
        branches: 68,
        // the deterministic engines are the core of the game and must stay well covered
        "src/engine/**": { lines: 92, branches: 78 },
      },
    },
  },
});
