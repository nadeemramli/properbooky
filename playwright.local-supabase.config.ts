import { defineConfig, devices } from "@playwright/test";

// PBK-30 runtime suite: real browser -> Next production server -> local
// Supabase (auth, PostgREST, storage, Mailpit). Run via scripts/pbk30-verify.sh,
// which builds the app against the local stack and restarts it for the
// criterion-5 phase. Production mode is required: `next dev` forces the
// dev-mode auth bypass.
const artifacts = process.env.PBK30_ARTIFACTS ?? "test-results/pbk30";

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
  reporter: [["list"], ["json", { outputFile: `${artifacts}/results-${process.env.PBK30_PHASE ?? "before-restart"}.json` }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next start -H 127.0.0.1 -p 3000",
    url: "http://127.0.0.1:3000/auth",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
