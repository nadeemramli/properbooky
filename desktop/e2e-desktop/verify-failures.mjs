// Proves the packaged E2E fails loudly, in the intended phase, and cleans up:
// each injected fault must exit with its code within a bound, pass every
// setup step that precedes its phase, fail at exactly the expected step with
// the expected message, and leave explicit cleanup evidence with no marked
// driver/app processes behind.
//
// Timing: the whole-run watchdog (setup included) is separate from the stall
// deadline, which run-packaged.mjs arms only on entering the stall phase.
// A slow-setup case proves setup time does not consume the stall budget, and
// an early-timeout control proves a watchdog firing during setup is never
// accepted as stall verification.
//
// Usage: E2E_APP=/path/to/desktop node e2e-desktop/verify-failures.mjs
//   E2E_VERIFY_SELFTEST=1  control run: checks the "assert" fault against the
//                          corrupt-fixture expectation and must exit 1.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(
  process.env.E2E_ARTIFACTS ?? path.join(os.tmpdir(), `pbk-e2e-failures-${Date.now()}`),
);
const SELFTEST = process.env.E2E_VERIFY_SELFTEST === "1";

// Hosted CI: ~31s per app launch, ~62s for the slowest fault case.
const WHOLE_RUN_MS = 150000;
const CLEANUP_MARGIN_MS = 15000;
const STALL_MS = 20000;
const SLOW_SETUP_MS = STALL_MS + 5000;
const EARLY_TIMEOUT_MS = 15000;

const DRIVER = ["app binary and fixtures present", "fresh isolated app-data and library copy", "tauri-driver ready"];
const SETUP = [...DRIVER, "launch packaged app: tab rail visible", "embedded frontend (no dev server)"];
const INDEXED = [...SETUP, "fresh app-data has no configured library"];

const stallExpectation = {
  env: { E2E_FAULT: "stall" },
  expectCode: 124,
  expectResult: "stall-timeout",
  mustPass: SETUP,
  failStep: "stall deadline",
  failMessage: new RegExp(`deliberate stall exceeded its ${STALL_MS}ms phase deadline`),
  extra: (report) => {
    const problems = [];
    const s = report.stall;
    if (!s || typeof s.entered_at_ms !== "number") return ["stall phase was never entered"];
    if (typeof s.fired_at_ms !== "number") problems.push("stall deadline did not fire");
    else {
      const waited = s.fired_at_ms - s.entered_at_ms;
      // Monotonic timings; Node timers may fire ~1ms early, hence 10ms slack.
      if (waited < STALL_MS - 10 || waited > STALL_MS + 5000) problems.push(`stall deadline fired ${waited}ms after entry, expected ${STALL_MS}-${STALL_MS + 5000}ms`);
    }
    if (report.steps.some((step) => step.name === "watchdog")) problems.push("whole-run watchdog fired");
    return problems;
  },
};

const cases = [
  {
    name: "assert",
    env: { E2E_FAULT: "assert" },
    expectCode: 1,
    mustPass: INDEXED,
    failStep: "index fixture library through the first-run form",
    failMessage: /deliberately failing fixture expectation/,
  },
  {
    name: "missing-fixture",
    env: { E2E_FAULT: "missing-fixture" },
    expectCode: 1,
    mustPass: INDEXED,
    failStep: "index fixture library through the first-run form",
    failMessage: /saw \["basalt ledger handbook","quillfeather orbit atlas"\]/,
  },
  {
    name: "corrupt-fixture",
    env: { E2E_FAULT: "corrupt-fixture" },
    expectCode: 1,
    mustPass: [...INDEXED, "index fixture library through the first-run form", "search a known fixture"],
    failStep: "open PDF fixture",
    failMessage: /reader error: .*Invalid PDF/,
  },
  {
    name: "stall",
    ...stallExpectation,
    env: { E2E_FAULT: "stall", E2E_STALL_MS: String(STALL_MS) },
  },
  {
    // Regression: setup longer than the stall budget must not consume it.
    name: "stall-after-slow-setup",
    ...stallExpectation,
    env: { E2E_FAULT: "stall", E2E_STALL_MS: String(STALL_MS), E2E_SETUP_DELAY_MS: String(SLOW_SETUP_MS) },
    mustPass: [...DRIVER, "injected setup delay", ...SETUP.slice(DRIVER.length)],
    extra: (report) => {
      const problems = stallExpectation.extra(report);
      if (!(report.stall?.entered_at_ms > STALL_MS)) {
        problems.push(`stall entered at ${report.stall?.entered_at_ms}ms; setup did not exceed the ${STALL_MS}ms stall budget`);
      }
      return problems;
    },
  },
  {
    name: "wrong-restore",
    env: { E2E_FAULT: "wrong-restore" },
    expectCode: 1,
    mustPass: [
      ...INDEXED,
      "open EPUB fixture and turn a page",
      "close app (session 1)",
      "relaunch same packaged binary",
      "PDF reopens at the recorded page",
    ],
    failStep: "EPUB position survives restart",
    failMessage: /EPUB restored at epubcfi\(.*\), expected the recorded epubcfi\(/,
  },
  {
    // A hung launch fails as setup with its own bound.
    name: "launch-timeout",
    env: { E2E_LAUNCH_TIMEOUT_MS: "1" },
    expectCode: 1,
    mustPass: DRIVER,
    failStep: "launch packaged app: tab rail visible",
    failMessage: /launch exceeded 1ms/,
  },
  {
    // Negative control: the whole-run watchdog firing during setup is a
    // setup failure and must be rejected by the stall expectation.
    name: "early-timeout-control",
    env: { E2E_FAULT: "stall", E2E_SETUP_DELAY_MS: "60000", E2E_TIMEOUT_MS: String(EARLY_TIMEOUT_MS) },
    expectCode: 124,
    expectResult: "timeout",
    mustPass: DRIVER,
    mustNotPass: ["launch packaged app: tab rail visible"],
    failStep: "watchdog",
    failMessage: new RegExp(`run exceeded ${EARLY_TIMEOUT_MS}ms`),
    rejectedBy: stallExpectation,
  },
];

const selected = SELFTEST
  ? [{ ...cases.find((c) => c.name === "corrupt-fixture"), name: "selftest-assert-vs-corrupt", env: { E2E_FAULT: "assert" } }]
  : cases;

function markedBy(runId) {
  const found = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      if (readFileSync(`/proc/${pid}/environ`, "latin1").includes(`PB_E2E_RUN=${runId}`)) found.push(Number(pid));
    } catch {}
  }
  return found;
}

function run(env, artifacts) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [path.join(here, "run-packaged.mjs")], {
      env: { ...process.env, E2E_TIMEOUT_MS: String(WHOLE_RUN_MS), ...env, E2E_ARTIFACTS: artifacts },
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => resolve({ code, signal, ms: Math.round(performance.now() - t0) }));
  });
}

function evaluate(c, code, report) {
  const problems = [];
  if (code !== c.expectCode) problems.push(`exit ${code}, expected ${c.expectCode}`);
  if (!report) return [...problems, "no report.json"];
  const fault = c.env?.E2E_FAULT ?? null;
  if ((report.fault ?? null) !== fault) problems.push(`report fault ${report.fault}, expected ${fault}`);
  if (c.expectResult && report.result !== c.expectResult) problems.push(`result ${report.result}, expected ${c.expectResult}`);
  const ok = new Set(report.steps.filter((s) => s.ok).map((s) => s.name));
  const missing = c.mustPass.filter((name) => !ok.has(name));
  if (missing.length) problems.push(`did not reach the intended phase; setup steps not passed: ${missing.join(", ")}`);
  for (const name of c.mustNotPass ?? []) if (ok.has(name)) problems.push(`"${name}" unexpectedly passed`);
  const failed = report.steps.find((s) => !s.ok) ?? null;
  if (!failed) problems.push("report names no failed step");
  else {
    if (failed.name !== c.failStep) problems.push(`first failed step "${failed.name}", expected "${c.failStep}"`);
    if (!c.failMessage.test(failed.error ?? "")) problems.push(`failure message ${JSON.stringify(failed.error)} does not match ${c.failMessage}`);
  }
  if (c.extra) problems.push(...c.extra(report));
  return problems;
}

function cleanupProblems(report) {
  const problems = [];
  const cleanup = report?.cleanup;
  if (!cleanup) return ["no cleanup evidence in report"];
  if (cleanup.run_marker !== report.run_id) problems.push("cleanup evidence is for a different run marker");
  if (!Array.isArray(cleanup.leftover)) problems.push("cleanup evidence has no leftover scan");
  else if (cleanup.leftover.length) problems.push(`leftover processes ${JSON.stringify(cleanup.leftover)}`);
  if (cleanup.driver_started !== true || cleanup.driver_exited !== true) {
    problems.push(`driver lifecycle not evidenced (started=${cleanup.driver_started}, exited=${cleanup.driver_exited})`);
  }
  const still = markedBy(report.run_id);
  if (still.length) problems.push(`independent /proc scan found marked processes ${still.join(",")}`);
  return problems;
}

const results = [];
for (const c of selected) {
  const artifacts = path.join(root, c.name);
  mkdirSync(artifacts, { recursive: true });
  console.log(`\n=== case: ${c.name} ${JSON.stringify(c.env)} ===`);
  const { code, signal, ms } = await run(c.env, artifacts);
  const reportFile = path.join(artifacts, "report.json");
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : null;
  const bound = Number(c.env.E2E_TIMEOUT_MS ?? WHOLE_RUN_MS) + CLEANUP_MARGIN_MS;
  const problems = [...evaluate(c, code, report), ...cleanupProblems(report)];
  if (signal) problems.push(`terminated by ${signal}`);
  if (ms > bound) problems.push(`took ${ms}ms, bound ${bound}ms`);
  let rejection = null;
  if (c.rejectedBy) {
    rejection = evaluate(c.rejectedBy, code, report);
    if (!rejection.length) problems.push("stall expectation ACCEPTED a setup-phase timeout");
  }
  const failed = report?.steps.find((s) => !s.ok);
  results.push({
    case: c.name,
    env: c.env,
    exit_code: code,
    duration_ms: ms,
    expected_step: c.failStep,
    failed_step: failed ? `${failed.name}: ${failed.error}` : null,
    stall: report?.stall ?? null,
    rejected_by_stall_expectation: rejection,
    cleanup: report?.cleanup ?? null,
    evidence: artifacts,
    ok: problems.length === 0,
    problems,
  });
}

writeFileSync(path.join(root, "failures-summary.json"), JSON.stringify(results, null, 2));
console.log("\n" + JSON.stringify(results.map(({ cleanup, env, ...r }) => r), null, 2));
const ok = results.every((r) => r.ok);
console.log(`FAILURE-PATH VERIFICATION${SELFTEST ? " (SELF-TEST)" : ""}: ${ok ? "PASS" : "FAIL"} — ${path.join(root, "failures-summary.json")}`);
process.exit(ok ? 0 : 1);
