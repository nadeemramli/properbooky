// Shared packaged-desktop E2E harness (moved verbatim from run-packaged.mjs,
// PBK-18): drives a built ProperBooky binary through tauri-driver
// (WebKitWebDriver) with a fresh per-run app-data directory. Each journey
// script is its own process, so this module's state is per run.
//
// Environment:
//   E2E_APP         binary under test (default: src-tauri/target/debug/desktop)
//   E2E_ARTIFACTS   directory for report.json, logs and failure screenshots
//   E2E_TIMEOUT_MS  hard watchdog for the whole run, setup included
//                   (default chosen by the journey script)
//   E2E_LAUNCH_TIMEOUT_MS  bound per app launch (default 90000; hosted CI
//                   launches take ~31s, local ~1s)
//   E2E_STALL_MS    deadline armed only when a deliberate stall phase is
//                   entered (default 20000), so setup time never consumes it
//   E2E_FAULT       disposable failure injection, interpreted by the journey
//   E2E_KEEP=1      keep the temporary app-data/library after the run
//
// Exit codes: 0 pass, 1 failed assertion/setup (including a launch that
// exceeds its bound), 124 timeout (result "timeout" for the whole-run
// watchdog, "stall-timeout" for the armed stall-phase deadline).

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.join(here, "fixtures", "library");

export const APP = path.resolve(
  process.env.E2E_APP ?? path.join(here, "../src-tauri/target/debug/desktop"),
);
export const FAULT = process.env.E2E_FAULT ?? "";
const LAUNCH_TIMEOUT_MS = Number(process.env.E2E_LAUNCH_TIMEOUT_MS ?? 90000);
const STALL_MS = Number(process.env.E2E_STALL_MS ?? 20000);
export const SETUP_DELAY_MS = Number(process.env.E2E_SETUP_DELAY_MS ?? 0);
const PORT = Number(process.env.E2E_DRIVER_PORT ?? 4444);
export const RUN_ID = `pbk-e2e-${randomUUID()}`;
export const ARTIFACTS = path.resolve(
  process.env.E2E_ARTIFACTS ?? path.join(os.tmpdir(), RUN_ID, "artifacts"),
);
export const RESPONSIVE_MS = 5000;

const started = Date.now();
const monoStart = performance.now();
const elapsed = () => Math.round(performance.now() - monoStart);
export const report = {
  run_id: RUN_ID,
  fault: FAULT || null,
  started_at: new Date(started).toISOString(),
  platform: `${os.platform()} ${os.release()}`,
  app: null,
  fixtures: [],
  steps: [],
  cleanup: null,
  result: "running",
  exit_code: null,
};

mkdirSync(ARTIFACTS, { recursive: true });
export const log = (...parts) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...parts);
export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

let driver = null;
export let browser = null;
let tempRoot = null;
let finishing = false;

/** The run's disposable root; finish() lists then removes it. */
export function setTempRoot(dir) {
  tempRoot = dir;
}


export async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) });
    log("ok  ", name, detail ? JSON.stringify(detail) : "");
    return detail;
  } catch (e) {
    report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e) });
    log("FAIL", name, String(e?.message ?? e));
    throw e;
  }
}

export function check(condition, message) {
  if (!condition) throw new Error(message);
}

// --- process hygiene -------------------------------------------------------

export function markedProcesses() {
  const found = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    if (Number(pid) === process.pid) continue;
    try {
      const environ = readFileSync(`/proc/${pid}/environ`, "latin1");
      if (environ.includes(`PB_E2E_RUN=${RUN_ID}`)) {
        let exe = "?";
        try {
          exe = readlinkSync(`/proc/${pid}/exe`);
        } catch {}
        found.push({ pid: Number(pid), exe });
      }
    } catch {
      /* process exited or not ours */
    }
  }
  return found;
}

export async function cleanup() {
  const result = {
    run_marker: RUN_ID,
    marked_before: markedProcesses().length,
    session_closed: false,
    driver_started: Boolean(driver),
    driver_exited: null,
    signalled: [],
    leftover: [],
  };
  if (browser) {
    result.session_closed = await Promise.race([
      browser.deleteSession().then(() => true, () => false),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]);
    browser = null;
  }
  if (driver && driver.exitCode === null) {
    try {
      process.kill(-driver.pid, "SIGTERM");
    } catch {}
  }
  for (let i = 0; i < 20 && markedProcesses().length; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const proc of markedProcesses()) {
    try {
      process.kill(proc.pid, "SIGKILL");
      result.signalled.push(proc);
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 300));
  result.leftover = markedProcesses();
  if (driver) result.driver_exited = driver.exitCode !== null || driver.signalCode !== null;
  result.checked_at = new Date().toISOString();
  return result;
}

export async function finish(code, result) {
  if (finishing) return;
  finishing = true;
  if (code !== 0 && browser) {
    try {
      await Promise.race([
        browser.saveScreenshot(path.join(ARTIFACTS, "failure.png")),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      const source = await Promise.race([
        browser.getPageSource(),
        new Promise((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (source) writeFileSync(path.join(ARTIFACTS, "failure.html"), source);
      // Visible text in the log too, for when artifacts cannot be fetched.
      const text = await Promise.race([
        browser.execute(() => document.body?.innerText.slice(0, 1200) ?? ""),
        new Promise((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (text !== null) {
        report.failure_ui_text = text;
        log("visible UI at failure:", JSON.stringify(text));
      }
    } catch {}
  }
  report.cleanup = await cleanup();
  if (report.cleanup.leftover.length && code === 0) {
    code = 1;
    result = "fail";
    report.steps.push({ name: "no leftover driver/app processes", ok: false, error: JSON.stringify(report.cleanup.leftover) });
  }
  if (tempRoot && existsSync(tempRoot)) {
    report.app_data_listing = listTree(path.join(tempRoot, "data"));
    report.library_state_listing = listTree(path.join(tempRoot, "library", ".properbooky"));
    if (process.env.E2E_KEEP !== "1") rmSync(tempRoot, { recursive: true, force: true });
  }
  report.result = result;
  report.exit_code = code;
  report.duration_ms = Date.now() - started;
  writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
  log(`DESKTOP PACKAGED E2E: ${result.toUpperCase()} (exit ${code}) — ${path.join(ARTIFACTS, "report.json")}`);
  process.exit(code);
}

export function listTree(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ path: path.relative(dir, full), bytes: statSync(full).size });
    }
  };
  walk(dir);
  return out;
}

// Whole-run watchdog: armed before the first step, so setup time counts.
let watchdog = null;
export function startWatchdog(defaultMs) {
  const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? defaultMs);
  watchdog = setTimeout(() => {
    log(`watchdog: run exceeded ${timeoutMs}ms`);
    report.steps.push({ name: "watchdog", ok: false, error: `run exceeded ${timeoutMs}ms` });
    finish(124, "timeout");
  }, timeoutMs);
}
export function stopWatchdog() {
  clearTimeout(watchdog);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => finish(130, "interrupted"));
}

// --- webview helpers -------------------------------------------------------

export const setInput = (selector, value) =>
  browser.execute(
    (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element ${sel}`);
      // WebKitWebDriver rejects wdio key input; drive React's controlled input natively.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );

export const cardTitles = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll(".grid .card h2")).map((h) => h.textContent.trim()),
  );

// Commands that are not bound to one library (PBK-15).
const UNBOUND = new Set([
  "get_library_state",
  "list_libraries",
  "add_library",
  "switch_library",
  "rename_library",
  "remove_library",
  "relocate_library",
]);

// Calls the same Tauri command boundary the UI uses (client → Rust → files).
// Like the UI, library-scoped calls carry the open library's id unless the
// caller binds one explicitly.
export const invoke = async (command, args = {}) => {
  if (!UNBOUND.has(command) && !("libraryId" in args)) {
    const state = await rawInvoke("get_library_state");
    args = { ...args, libraryId: state.library_id };
  }
  return rawInvoke(command, args);
};

export const rawInvoke = async (command, args) => {
  const result = await browser.execute(
    async (cmd, a) => {
      try {
        return { ok: await window.__TAURI_INTERNALS__.invoke(cmd, a) };
      } catch (e) {
        return { err: String(e) };
      }
    },
    command,
    args,
  );
  if (result && "err" in result) throw new Error(`${command}: ${result.err}`);
  return result?.ok;
};

export async function waitFor(what, predicate, timeout) {
  let last;
  await browser.waitUntil(
    async () => {
      last = await predicate();
      return Boolean(last);
    },
    { timeout, interval: 100, timeoutMsg: `${what} not observed within ${timeout}ms` },
  );
  return last;
}

export async function waitTitles(expected, timeout = RESPONSIVE_MS) {
  const t0 = Date.now();
  let titles = [];
  try {
    await waitFor(
      `cards ${JSON.stringify(expected)}`,
      async () => {
        titles = (await cardTitles()).sort();
        return JSON.stringify(titles) === JSON.stringify(expected);
      },
      timeout,
    );
  } catch {
    throw new Error(`expected cards ${JSON.stringify(expected)}, saw ${JSON.stringify(titles)}`);
  }
  return { titles, ms: Date.now() - t0 };
}

export async function readerError() {
  const el = await browser.$(".reader-error");
  return (await el.isExisting()) ? await el.getText() : null;
}

export async function openCard(title) {
  const clicked = await browser.execute((t) => {
    const card = Array.from(document.querySelectorAll(".grid .card")).find(
      (c) => c.querySelector("h2")?.textContent.trim() === t,
    );
    const button = card?.querySelector(".read-book");
    if (!button) return false;
    button.click();
    return true;
  }, title);
  check(clicked, `no openable card titled "${title}"`);
}

export async function pdfPage(timeout = 20000) {
  return waitFor(
    "PDF page number",
    async () => {
      const error = await readerError();
      if (error) throw new Error(`reader error: ${error}`);
      // The page input shows "1" before the document loads; only trust it
      // once the page count ("of N") is known, or Next is clamped to page 1.
      const value = await browser.execute(() => {
        const loaded = /of \d+/.test(document.querySelector(".reader-bar .reader-progress")?.textContent ?? "");
        return document.querySelector(".reader-page-pdf") && loaded
          ? document.querySelector('.reader-bar input[type="number"]')?.value
          : null;
      });
      return value || null;
    },
    timeout,
  );
}

export async function sidecarPosition(bookPath, predicate, what) {
  return waitFor(
    what,
    async () => {
      const sidecar = await invoke("get_sidecar", { path: bookPath });
      return predicate(sidecar?.position) ? sidecar.position : null;
    },
    10000,
  );
}

export async function backToLibraryAndSearch(term, expected) {
  await browser.$(".tab-library").click();
  await waitFor(
    "enabled library search",
    () => browser.execute(() => {
      const el = document.querySelector('.toolbar input[type="search"]');
      return Boolean(el && !el.disabled);
    }),
    RESPONSIVE_MS,
  );
  await setInput('.toolbar input[type="search"]', term);
  return waitTitles(expected);
}

export async function startDriver(env) {
  const busy = await new Promise((resolve) => {
    const socket = net.connect(PORT, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
  check(!busy, `port ${PORT} is already in use; refusing to attach to a foreign driver`);
  const binary = process.env.TAURI_DRIVER ?? "tauri-driver";
  const out = createWriteStream(path.join(ARTIFACTS, "tauri-driver.log"), { flags: "a" });
  driver = spawn(binary, ["--port", String(PORT)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  driver.stdout.pipe(out);
  driver.stderr.pipe(out);
  const spawnError = new Promise((_, reject) => driver.once("error", reject));
  await Promise.race([
    spawnError,
    (async () => {
      for (let i = 0; i < 150; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${PORT}/status`);
          if (res.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("tauri-driver did not become ready within 15s");
    })(),
  ]);
}

// Binary of the current session; a journey may launch another build (e.g.
// the previous release for an upgrade/rollback rehearsal).
let launched = APP;

export async function launchApp(app = APP) {
  launched = app;
  // A hung launch is a setup failure with its own bound; it must never be
  // absorbed by (or mistaken for) a later phase's deadline.
  let timer;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`launch exceeded ${LAUNCH_TIMEOUT_MS}ms`)), LAUNCH_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      bound,
      (async () => {
        browser = await remote({
          hostname: "127.0.0.1",
          port: PORT,
          logLevel: "warn",
          connectionRetryCount: 0,
          connectionRetryTimeout: LAUNCH_TIMEOUT_MS + 5000,
          capabilities: { alwaysMatch: { "tauri:options": { application: app } } },
        });
        // DOM queries, not element handles: the rail is re-rendered once the
        // saved library list loads (PBK-15), which would stale a handle.
        await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".tab-rail"))), {
          timeout: 30000,
          interval: 100,
          timeoutMsg: "tab rail not rendered within 30000ms",
        });
        check(
          await browser.execute(() => Boolean(document.querySelector(".tab-library"))),
          "Library tab missing from the tab rail",
        );
      })(),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// The deliberate-stall deadline starts only when that phase is entered.
// Phase timings use the monotonic clock; wall-clock time can jump (e.g. VM sync).
export function armStallDeadline() {
  report.stall = { clock: "monotonic", entered_at_ms: elapsed(), armed_ms: STALL_MS, fired_at_ms: null };
  log(`stall phase entered; deadline armed for ${STALL_MS}ms`);
  setTimeout(() => {
    report.stall.fired_at_ms = elapsed();
    report.steps.push({
      name: "stall deadline",
      ok: false,
      error: `deliberate stall exceeded its ${STALL_MS}ms phase deadline (entered at ${report.stall.entered_at_ms}ms)`,
    });
    finish(124, "stall-timeout");
  }, STALL_MS);
}

export async function closeApp() {
  await browser.deleteSession();
  browser = null;
  // The app exits with its session; only the driver should remain marked.
  const app = realpathSync(launched);
  for (let i = 0; i < 100; i++) {
    if (!markedProcesses().some((p) => p.exe === app)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("app process still running 10s after session close");
}
