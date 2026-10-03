// Proves the packaged E2E fails loudly, in the intended phase, and cleans up:
// each injected fault must exit with its code within a bound, pass every
// setup step that precedes its phase, fail at exactly the expected step with
// the expected message, and leave explicit cleanup evidence with no marked
// driver/app processes behind.
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
const STALL_TIMEOUT_MS = 30000;
const SELFTEST = process.env.E2E_VERIFY_SELFTEST === "1";

const SETUP = [
  "app binary and fixtures present",
  "fresh isolated app-data and library copy",
  "tauri-driver ready",
  "launch packaged app: tab rail visible",
  "embedded frontend (no dev server)",
];
const INDEXED = [...SETUP, "fresh app-data has no configured library"];

const cases = [
  {
    fault: "assert",
    expectCode: 1,
    boundMs: 120000,
    mustPass: INDEXED,
    failStep: "index fixture library through the first-run form",
    failMessage: /deliberately failing fixture expectation/,
  },
  {
    fault: "missing-fixture",
    expectCode: 1,
    boundMs: 120000,
    mustPass: INDEXED,
    failStep: "index fixture library through the first-run form",
    failMessage: /saw \["basalt ledger handbook","quillfeather orbit atlas"\]/,
  },
  {
    fault: "corrupt-fixture",
    expectCode: 1,
    boundMs: 120000,
    mustPass: [...INDEXED, "index fixture library through the first-run form", "search a known fixture"],
    failStep: "open PDF fixture",
    failMessage: /reader error: .*Invalid PDF/,
  },
  {
    fault: "stall",
    expectCode: 124,
    expectResult: "timeout",
    boundMs: STALL_TIMEOUT_MS + 30000,
    mustPass: SETUP,
    failStep: "watchdog",
    failMessage: new RegExp(`run exceeded ${STALL_TIMEOUT_MS}ms`),
  },
  {
    fault: "wrong-restore",
    expectCode: 1,
    boundMs: 180000,
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
];

const selected = SELFTEST
  ? [{ ...cases.find((c) => c.fault === "corrupt-fixture"), fault: "assert" }]
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

function run(fault, artifacts) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(here, "run-packaged.mjs")], {
      env: {
        ...process.env,
        E2E_FAULT: fault,
        E2E_ARTIFACTS: artifacts,
        ...(fault === "stall" ? { E2E_TIMEOUT_MS: String(STALL_TIMEOUT_MS) } : {}),
      },
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => resolve({ code, signal, ms: Date.now() - t0 }));
  });
}

const results = [];
for (const c of selected) {
  const artifacts = path.join(root, c.fault);
  mkdirSync(artifacts, { recursive: true });
  console.log(`\n=== injected fault: ${c.fault}${SELFTEST ? " (self-test, mismatched expectation)" : ""} ===`);
  const { code, signal, ms } = await run(c.fault, artifacts);
  const reportFile = path.join(artifacts, "report.json");
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : null;
  const problems = [];
  if (code !== c.expectCode) problems.push(`exit ${code}${signal ? ` (${signal})` : ""}, expected ${c.expectCode}`);
  if (ms > c.boundMs) problems.push(`took ${ms}ms, bound ${c.boundMs}ms`);

  let failed = null;
  if (!report) {
    problems.push("no report.json");
  } else {
    if (report.fault !== c.fault) problems.push(`report fault ${report.fault}, expected ${c.fault}`);
    if (c.expectResult && report.result !== c.expectResult) problems.push(`result ${report.result}, expected ${c.expectResult}`);
    const ok = new Set(report.steps.filter((s) => s.ok).map((s) => s.name));
    const missing = c.mustPass.filter((name) => !ok.has(name));
    if (missing.length) problems.push(`did not reach the intended phase; setup steps not passed: ${missing.join(", ")}`);
    failed = report.steps.find((s) => !s.ok) ?? null;
    if (!failed) problems.push("report names no failed step");
    else {
      if (failed.name !== c.failStep) problems.push(`first failed step "${failed.name}", expected "${c.failStep}"`);
      if (!c.failMessage.test(failed.error ?? "")) problems.push(`failure message ${JSON.stringify(failed.error)} does not match ${c.failMessage}`);
    }
    const cleanup = report.cleanup;
    if (!cleanup) problems.push("no cleanup evidence in report");
    else {
      if (cleanup.run_marker !== report.run_id) problems.push("cleanup evidence is for a different run marker");
      if (!Array.isArray(cleanup.leftover)) problems.push("cleanup evidence has no leftover scan");
      else if (cleanup.leftover.length) problems.push(`leftover processes ${JSON.stringify(cleanup.leftover)}`);
      if (cleanup.driver_started !== true || cleanup.driver_exited !== true) {
        problems.push(`driver lifecycle not evidenced (started=${cleanup.driver_started}, exited=${cleanup.driver_exited})`);
      }
    }
    const still = markedBy(report.run_id);
    if (still.length) problems.push(`independent /proc scan found marked processes ${still.join(",")}`);
  }

  results.push({
    fault: c.fault,
    exit_code: code,
    duration_ms: ms,
    expected_step: c.failStep,
    failed_step: failed ? `${failed.name}: ${failed.error}` : null,
    cleanup: report?.cleanup ?? null,
    evidence: artifacts,
    ok: problems.length === 0,
    problems,
  });
}

writeFileSync(path.join(root, "failures-summary.json"), JSON.stringify(results, null, 2));
console.log("\n" + JSON.stringify(results.map(({ cleanup, ...r }) => r), null, 2));
const ok = results.every((r) => r.ok);
console.log(`FAILURE-PATH VERIFICATION${SELFTEST ? " (SELF-TEST)" : ""}: ${ok ? "PASS" : "FAIL"} — ${path.join(root, "failures-summary.json")}`);
process.exit(ok ? 0 : 1);
