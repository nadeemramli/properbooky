// Proves the packaged E2E fails loudly and cleans up: each injected fault
// must exit nonzero within its bound, leave a report naming the failed step,
// and leave no driver/app processes behind.
//
// Usage: E2E_APP=/path/to/desktop node e2e-desktop/verify-failures.mjs

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(
  process.env.E2E_ARTIFACTS ?? path.join(os.tmpdir(), `pbk-e2e-failures-${Date.now()}`),
);
const STALL_TIMEOUT_MS = 30000;

const cases = [
  { fault: "assert", expectCode: 1, boundMs: 120000 },
  { fault: "missing-fixture", expectCode: 1, boundMs: 120000 },
  { fault: "corrupt-fixture", expectCode: 1, boundMs: 120000 },
  { fault: "stall", expectCode: 124, boundMs: STALL_TIMEOUT_MS + 30000 },
];

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
    child.on("exit", (code) => resolve({ code, ms: Date.now() - t0 }));
  });
}

const results = [];
for (const c of cases) {
  const artifacts = path.join(root, c.fault);
  mkdirSync(artifacts, { recursive: true });
  console.log(`\n=== injected fault: ${c.fault} ===`);
  const { code, ms } = await run(c.fault, artifacts);
  const reportFile = path.join(artifacts, "report.json");
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : null;
  const failedStep = report?.steps.find((s) => !s.ok);
  const problems = [];
  if (code === 0) problems.push("exited 0");
  if (code !== c.expectCode) problems.push(`exit ${code}, expected ${c.expectCode}`);
  if (ms > c.boundMs) problems.push(`took ${ms}ms, bound ${c.boundMs}ms`);
  if (!report) problems.push("no report.json");
  if (!failedStep) problems.push("report names no failed step");
  if (report?.cleanup?.leftover?.length) problems.push(`leftover processes ${JSON.stringify(report.cleanup.leftover)}`);
  results.push({
    fault: c.fault,
    exit_code: code,
    duration_ms: ms,
    failed_step: failedStep ? `${failedStep.name}: ${failedStep.error}` : null,
    leftover_processes: report?.cleanup?.leftover?.length ?? null,
    evidence: artifacts,
    ok: problems.length === 0,
    problems,
  });
}

writeFileSync(path.join(root, "failures-summary.json"), JSON.stringify(results, null, 2));
console.log("\n" + JSON.stringify(results, null, 2));
const ok = results.every((r) => r.ok);
console.log(`FAILURE-PATH VERIFICATION: ${ok ? "PASS" : "FAIL"} — ${path.join(root, "failures-summary.json")}`);
process.exit(ok ? 0 : 1);
