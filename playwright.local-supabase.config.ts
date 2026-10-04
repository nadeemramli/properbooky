import { defineConfig, devices } from "@playwright/test";

// PBK-30 runtime suite: real browser -> Next production server -> the
// disposable fixture Supabase stack (scripts/pbk30-stack.sh). Run via
// scripts/pbk30-verify.sh, which builds and serves the app on :3130 and
// restarts it for the criterion-5 phase. Global setup refuses to run unless
// the marked fixture stack is the target (scripts/pbk30-fixture-guard.mjs).
const artifacts = process.env.PBK30_ARTIFACTS ?? ".pbk30";
const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e/local-supabase",
  testMatch:
    process.env.PBK30_PHASE === "after-restart"
      ? /c5-.*\.spec\.ts/
      : process.env.PBK30_PHASE === "dev-mode"
      ? /dev-mode\.spec\.ts/
      : /c[234]-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: `${artifacts}/output`,
  globalSetup: "./e2e/local-supabase/global-setup.ts",
  reporter: [["list"], ["json", { outputFile: `${artifacts}/results-${process.env.PBK30_PHASE ?? "before-restart"}.json` }]],
  use: {
    baseURL: process.env.PBK30_APP_URL ?? "http://127.0.0.1:3130",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: chromium !== undefined && chromium !== "" ? { executablePath: chromium } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
