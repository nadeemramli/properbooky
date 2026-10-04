// Packaged desktop E2E: drives a built ProperBooky binary through
// tauri-driver (WebKitWebDriver) against the committed synthetic fixture
// library and a fresh, per-run app-data directory. No dev server and no
// personal library are involved.
//
// Usage (Linux, inside an X server or `xvfb-run -a`):
//   E2E_APP=/path/to/desktop node e2e-desktop/run-packaged.mjs
//
// The driver, launch bounds, watchdog/stall deadlines, process cleanup and
// report live in harness.mjs (shared with the PBK-24 reading journey).
//
// Environment:
//   E2E_APP         binary under test (default: src-tauri/target/debug/desktop)
//   E2E_ARTIFACTS   directory for report.json, logs and failure screenshots
//   E2E_TIMEOUT_MS  hard watchdog for the whole run, setup included
//                   (default 240000; hosted CI journeys take ~70s)
//   E2E_LAUNCH_TIMEOUT_MS  bound per app launch (default 90000; hosted CI
//                   launches take ~31s, local ~1s)
//   E2E_STALL_MS    deadline armed only when the deliberate stall phase is
//                   entered (default 20000), so setup time never consumes it
//   E2E_SETUP_DELAY_MS  test-only delay injected before the first launch
//   E2E_FAULT       disposable failure injection: assert | missing-fixture |
//                   corrupt-fixture | stall | wrong-restore
//   E2E_KEEP=1      keep the temporary app-data/library after the run
//
// Exit codes: 0 pass, 1 failed assertion/setup (including a launch that
// exceeds its bound), 124 timeout (result "timeout" for the whole-run
// watchdog, "stall-timeout" for the armed stall-phase deadline).

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APP,
  FAULT,
  RESPONSIVE_MS,
  RUN_ID,
  SETUP_DELAY_MS,
  armStallDeadline,
  backToLibraryAndSearch,
  browser,
  check,
  closeApp,
  finish,
  fixturesDir,
  invoke,
  launchApp,
  listTree,
  openCard,
  pdfPage,
  readerError,
  report,
  setInput,
  setTempRoot,
  sha256,
  sidecarPosition,
  startDriver,
  startWatchdog,
  step,
  stopWatchdog,
  waitFor,
  waitTitles,
} from "./harness.mjs";

const PDF_TITLE = "quillfeather orbit atlas";
const EPUB_TITLE = "Zephyr Lantern Field Notes";
const EXPECTED_TITLES = [
  EPUB_TITLE,
  "basalt ledger handbook",
  PDF_TITLE,
  ...(FAULT === "assert" ? ["deliberately failing fixture expectation"] : []),
].sort();

let epubTurnedPosition = null;
let epubWrongPosition = null;
const RESTORE_SENTINEL = -18.18;


// --- run -------------------------------------------------------------------

startWatchdog(240000);

try {
  await step("app binary and fixtures present", () => {
    check(existsSync(APP), `binary not found: ${APP} (build it first)`);
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    report.fixtures = readdirSync(fixturesDir)
      .sort()
      .map((name) => ({ name, sha256: sha256(path.join(fixturesDir, name)) }));
    check(report.fixtures.length === 3, `expected 3 committed fixtures, found ${report.fixtures.length}`);
    return { app_sha256: report.app.sha256, fixtures: report.fixtures.length };
  });

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  const libraryDir = path.join(tempRoot, "library");
  const pdfPath = path.join(libraryDir, "quillfeather-orbit-atlas.pdf");
  const epubPath = path.join(libraryDir, "Zephyr Lantern Field Notes.epub");

  await step("fresh isolated app-data and library copy", () => {
    cpSync(fixturesDir, libraryDir, { recursive: true });
    if (FAULT === "missing-fixture") unlinkSync(epubPath);
    if (FAULT === "corrupt-fixture") writeFileSync(pdfPath, "this is not a pdf\n");
    for (const d of ["data", "config", "cache", "state"]) mkdirSync(path.join(tempRoot, d));
    report.app_data_dir = path.join(tempRoot, "data");
    report.library_dir = libraryDir;
    return { root: tempRoot, fault: FAULT || null };
  });

  const env = {
    ...process.env,
    PB_E2E_RUN: RUN_ID,
    XDG_DATA_HOME: path.join(tempRoot, "data"),
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "cache"),
    XDG_STATE_HOME: path.join(tempRoot, "state"),
  };
  await step("tauri-driver ready", () => startDriver(env));

  if (SETUP_DELAY_MS > 0) {
    await step("injected setup delay", async () => {
      await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
      return { ms: SETUP_DELAY_MS };
    });
  }

  // Session 1: first run on empty app-data.
  await step("launch packaged app: tab rail visible", launchApp);

  await step("embedded frontend (no dev server)", async () => {
    const origin = await browser.execute(() => window.location.origin);
    check(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin), `webview loaded a dev server origin: ${origin}`);
    report.webview_origin = origin;
    return { origin };
  });

  if (FAULT === "stall") {
    await step("deliberate stall (phase deadline must fire)", () => {
      armStallDeadline();
      return browser.$(".never-rendered-by-properbooky").waitForExist({ timeout: 24 * 3600 * 1000 });
    });
  }

  await step("fresh app-data has no configured library", async () => {
    const state = await invoke("get_library_state");
    check(state.library_path === null, `app-data not fresh: library_path=${state.library_path}`);
    check(await browser.$(".path-form").isExisting(), "first-run library form not shown");
    return state;
  });

  await step("index fixture library through the first-run form", async () => {
    await setInput(".path-form input", libraryDir);
    // A WebDriver click on a still-disabled button is silently ignored.
    await waitFor(
      "enabled Index button",
      () => browser.execute(() => document.querySelector('.path-form button[type="submit"]')?.disabled === false),
      RESPONSIVE_MS,
    );
    await browser.$('.path-form button[type="submit"]').click();
    return waitTitles(EXPECTED_TITLES, 30000);
  });

  await step("search a known fixture", () => setInput('.toolbar input[type="search"]', "quillfeather").then(() => waitTitles([PDF_TITLE])));

  await step("open PDF fixture", async () => {
    await openCard(PDF_TITLE);
    const page = await pdfPage();
    check(page === "1", `PDF opened at page ${page}, expected 1`);
    return { page };
  });

  await step("turn a page", async () => {
    await browser.$('.reader-bar button[aria-label="Next page"]').click();
    await waitFor("page 2", async () => (await pdfPage()) === "2", RESPONSIVE_MS);
    return { page: "2" };
  });

  await step("position persisted across the Tauri boundary", async () => {
    const position = await sidecarPosition(pdfPath, (p) => p === "2", "PDF sidecar position 2");
    const stateFiles = listTree(path.join(libraryDir, ".properbooky"));
    check(stateFiles.length > 0, "no .properbooky state files written");
    return { position, state_files: stateFiles.length };
  });

  await step("return to Library and search again (responsive)", () => backToLibraryAndSearch("zephyr", [EPUB_TITLE]));

  await step("open EPUB fixture and turn a page", async () => {
    await openCard(EPUB_TITLE);
    await waitFor(
      "EPUB rendered",
      async () => {
        const error = await readerError();
        if (error) throw new Error(`reader error: ${error}`);
        return browser.execute(() => Boolean(document.querySelector(".reader iframe")) && !document.querySelector(".reader-loading"));
      },
      45000,
    );
    const isCfi = (p) => typeof p === "string" && p.startsWith("epubcfi(");
    const opened = await sidecarPosition(epubPath, isCfi, "EPUB CFI saved on open");
    await browser.$('.reader-bar button[aria-label="Next page"]').click();
    const position = await sidecarPosition(epubPath, (p) => isCfi(p) && p !== opened, "EPUB CFI advanced after Next");
    epubTurnedPosition = position;
    if (FAULT === "wrong-restore") {
      // Capture a later, non-initial location to feed the reader in session 2,
      // then put the recorded position back so the stored contract is unchanged.
      await browser.$('.reader-bar button[aria-label="Next page"]').click();
      epubWrongPosition = await sidecarPosition(epubPath, (p) => isCfi(p) && p !== position && p !== opened, "later EPUB CFI");
      // Leave the reader first: while open it may still (correctly) record
      // where it is, e.g. once its locations finish generating.
      await browser.$(".tab-library").click();
      await invoke("save_progress", { path: epubPath, position, percent: null });
      await sidecarPosition(epubPath, (p) => p === position, "recorded EPUB CFI restored");
    }
    return { opened, position, ...(epubWrongPosition ? { wrong: epubWrongPosition } : {}) };
  });

  await step("Library search clears back to the full fixture library", () => backToLibraryAndSearch("", EXPECTED_TITLES));

  await step("close app (session 1)", closeApp);

  // Session 2: restart the same binary on the same app-data.
  await step("relaunch same packaged binary", launchApp);

  await step("library persisted without re-selecting a folder", async () => {
    // LibraryView renders the first-run form until get_library_state resolves,
    // so only assert its absence once the persisted library has loaded.
    const state = await invoke("get_library_state");
    check(state.library_path === libraryDir, `library_path=${state.library_path}`);
    const loaded = await waitTitles(EXPECTED_TITLES, 30000);
    check(!(await browser.$(".path-form").isExisting()), "first-run form still shown after the library loaded");
    return loaded;
  });

  await step("PDF reopens at the recorded page", async () => {
    await setInput('.toolbar input[type="search"]', "quillfeather");
    await waitTitles([PDF_TITLE]);
    await openCard(PDF_TITLE);
    const page = await pdfPage();
    check(page === "2", `PDF restored at page ${page}, expected 2`);
    return { page };
  });

  await step("EPUB position survives restart", async () => {
    const position = await sidecarPosition(
      epubPath,
      (p) => p === epubTurnedPosition,
      `EPUB CFI ${epubTurnedPosition} after restart`,
    );
    // Mark the stored record with an impossible percent; wrong-restore feeds
    // the reader a different, later location instead of the recorded one.
    await invoke("save_progress", {
      path: epubPath,
      position: FAULT === "wrong-restore" ? epubWrongPosition : position,
      percent: RESTORE_SENTINEL,
    });
    await backToLibraryAndSearch("zephyr", [EPUB_TITLE]);
    await openCard(EPUB_TITLE);
    await waitFor(
      "EPUB rendered at saved position",
      async () => {
        const error = await readerError();
        if (error) throw new Error(`reader error: ${error}`);
        return browser.execute(() => Boolean(document.querySelector(".reader iframe")) && !document.querySelector(".reader-loading"));
      },
      45000,
    );
    // The reader saves its actual location (rendition "relocated") through
    // save_progress once it has displayed. The sentinel percent proves the
    // value read below came from that fresh write, not the pre-restart file.
    const reopened = await waitFor(
      "reopened reader reported its location",
      async () => {
        const sidecar = await invoke("get_sidecar", { path: epubPath });
        return sidecar?.percent !== RESTORE_SENTINEL ? sidecar.position : null;
      },
      15000,
    );
    check(reopened === position, `EPUB restored at ${reopened}, expected the recorded ${position}`);
    return { position, reopened };
  });

  await step("close app (session 2)", closeApp);

  stopWatchdog();
  await finish(0, "pass");
} catch {
  stopWatchdog();
  await finish(1, "fail");
}
