import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a running app (default http://localhost:3000).
 * Locally without Supabase: AUTH_MODE=dev + a local Postgres seeded with `npm run seed:synthetic`.
 * Against a real deployment: E2E_BASE_URL=https://... (email confirmation must be disabled for test accounts).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // optional pinned browser (e.g. sandboxed CI images); otherwise Playwright's managed browser is used
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
