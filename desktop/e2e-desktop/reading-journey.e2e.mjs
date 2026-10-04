// PBK-24 desktop reading journey, packaged: drives the built ProperBooky
// binary (tauri-driver/WebKitWebDriver, harness.mjs) through the actual grid,
// tab rail and EPUB/PDF readers against a temp copy of the committed
// synthetic fixtures plus four catalog profiles, with fresh app-data.
// Reading state is asserted on disk in <library>/.properbooky/state (the
// truth), across tab close/reopen, a restart of the same binary, an index
// rebuild from empty app-data and an in-app rescan. Failure inputs (0-byte
// EPUB, corrupt PDF, unreadable/unwritable sidecars) are created in the temp
// copy only.
//
// Usage (Linux, inside an X server or `xvfb-run -a`):
//   E2E_APP=/path/to/desktop node e2e-desktop/reading-journey.e2e.mjs
// Environment as in harness.mjs; default whole-run watchdog 480000ms.
//   E2E_FAULT=lost-position  delete the PDF sidecar between sessions; the
//                            restart assertion must fail (verify-failures).

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APP,
  ARTIFACTS,
  FAULT,
  RESPONSIVE_MS,
  RUN_ID,
  browser,
  cardTitles,
  check,
  closeApp,
  finish,
  fixturesDir,
  here,
  invoke,
  launchApp,
  listTree,
  pdfPage,
  readerError,
  report,
  setInput,
  setTempRoot,
  sha256,
  startDriver,
  startWatchdog,
  step,
  stopWatchdog,
  waitFor,
  waitTitles,
} from "./harness.mjs";

const catalogFixtures = path.join(here, "fixtures", "catalog");

const EPUB = "Zephyr Lantern Field Notes";
const PDF = "The Quillfeather Orbit Atlas"; // catalog profile linked to the PDF
const BASALT = "The Basalt Ledger Handbook"; // linked, status done
const MISSING = "Vanished Atlas"; // linked to a file that does not exist
const WISH = "Moonlit Wishlist Volume"; // wishlist, no file
const EMPTY = "hollow reed"; // 0-byte EPUB, created at run time
const CORRUPT = "cracked quartz"; // not a PDF, created at run time
const ALL = [EPUB, PDF, BASALT, MISSING, WISH, EMPTY, CORRUPT].sort();
const LINKED_FILE_TITLES = ["quillfeather orbit atlas", "basalt ledger handbook"];

const sorted = (list) => [...list].sort();
const isCfi = (p) => typeof p === "string" && p.startsWith("epubcfi(");

// --- library and sidecars on disk ------------------------------------------

let libraryDir = null;
const state = {};

function identityRecord(relative) {
  const registry = JSON.parse(readFileSync(path.join(libraryDir, ".properbooky/identities.json"), "utf8"));
  return registry.records.findLast((r) => r.path === relative) ?? null;
}

function sidecarFile(relative) {
  const record = identityRecord(relative);
  check(record?.state_file, `no identity/state file registered for ${relative}`);
  return path.join(libraryDir, ".properbooky/state", record.state_file);
}

function readSidecar(relative) {
  const file = sidecarFile(relative);
  return existsSync(file) && statSync(file).isFile() ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** Hash of every sidecar byte, to prove a step left them untouched. */
function stateDigest() {
  const dir = path.join(libraryDir, ".properbooky/state");
  return readdirSync(dir)
    .sort()
    .map((name) => `${name}:${sha256(path.join(dir, name))}`);
}

// Serde drops unknown keys when the app rewrites a sidecar, so a marker
// added here proves a later value came from a fresh write by the reader.
function markSidecar(relative) {
  const file = sidecarFile(relative);
  const value = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...value, e2e_marker: RUN_ID }, null, 2));
  return value;
}

async function rewrittenSidecar(relative, what, timeout = 15000) {
  return waitFor(
    what,
    async () => {
      const error = await readerError();
      if (error) throw new Error(`reader error: ${error}`);
      const value = readSidecar(relative);
      return value && value.e2e_marker === undefined ? value : null;
    },
    timeout,
  );
}

async function sidecarWhere(relative, predicate, what, timeout = 10000) {
  return waitFor(
    what,
    async () => {
      const value = readSidecar(relative);
      return value && predicate(value) ? value : null;
    },
    timeout,
  );
}

// --- UI helpers -------------------------------------------------------------

const shot = (name) => browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));

async function cards() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".grid .card")).map((card) => ({
      title: card.querySelector("h2").textContent.trim(),
      badge: card.querySelector(".badge")?.textContent.trim() ?? null,
      state: card.querySelector(".book-state")?.textContent.trim() ?? "",
      read: Array.from(card.querySelectorAll(".read-book")).map((b) => b.textContent.trim()),
      progress: card.querySelector('.card-progress[role="progressbar"]')?.getAttribute("aria-valuenow") ?? null,
    })),
  );
}

async function card(title) {
  const found = (await cards()).find((c) => c.title === title);
  check(found, `no card titled "${title}"`);
  return found;
}

// The Library view remounts unfiltered and re-fetches; wait for every card.
async function toLibrary() {
  await browser.$("#tab-library").click();
  await waitTitles(ALL);
}

async function chip(label, expected) {
  await browser.execute((l) => {
    const el = Array.from(document.querySelectorAll(".chips .chip")).find((c) => c.textContent === l);
    if (!el) throw new Error(`no filter chip ${l}`);
    el.click();
  }, label);
  return waitTitles(sorted(expected));
}

// The grid re-fetches whenever the Library tab mounts; wait for the card.
async function clickRead(title) {
  let seen = null;
  try {
    await waitFor(
      `Read button on "${title}"`,
      async () => {
        seen = await browser.execute((t) => {
          const found = Array.from(document.querySelectorAll(".grid .card")).find(
            (c) => c.querySelector("h2")?.textContent.trim() === t,
          );
          if (!found) return null;
          const buttons = found.querySelectorAll(".read-book");
          if (buttons.length === 1) buttons[0].click();
          return buttons.length;
        }, title);
        return seen === 1;
      },
      RESPONSIVE_MS,
    );
  } catch {
    throw new Error(`card "${title}" has ${seen ?? "no card and"} Read buttons, expected exactly 1`);
  }
}

async function tabs() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.tab-list [role="tab"]')).map((t) => ({
      id: t.id,
      title: t.childNodes[0]?.textContent.trim() ?? "",
      selected: t.getAttribute("aria-selected") === "true",
      focused: document.activeElement === t,
      ribbon: t.parentElement?.querySelector(".tab-ribbon")?.getAttribute("data-percent") ?? null,
      ribbonWidth: t.parentElement?.querySelector(".tab-ribbon")?.style.width ?? null,
    })),
  );
}

async function selectedTab() {
  return (await tabs()).find((t) => t.selected)?.title ?? null;
}

async function waitEpub() {
  await waitFor(
    "EPUB rendered",
    async () => {
      const error = await readerError();
      if (error) throw new Error(`reader error: ${error}`);
      return browser.execute(
        () => Boolean(document.querySelector(".reader iframe")) && !document.querySelector(".reader-loading"),
      );
    },
    45000,
  );
}

async function pdfText() {
  return waitFor(
    "PDF text layer",
    () => browser.execute(() => document.querySelector(".textLayer")?.textContent.trim() || null),
    RESPONSIVE_MS,
  );
}

async function pdfAt(page) {
  await waitFor(`PDF page ${page}`, async () => (await pdfPage()) === String(page), RESPONSIVE_MS);
  const text = await waitFor(
    `PDF page ${page} text`,
    () =>
      browser.execute(
        (p) => {
          const t = document.querySelector(".textLayer")?.textContent ?? "";
          return t.includes(`page ${p}`) ? t.trim() : null;
        },
        page,
      ),
    RESPONSIVE_MS,
  );
  return text;
}

async function notice() {
  return browser.execute(
    () => Array.from(document.querySelectorAll(".reader-notice")).map((n) => n.textContent.trim()).join(" | ") || null,
  );
}

async function pressKeys(...keys) {
  await browser.keys(keys);
}

async function focus(selector) {
  const ok = await browser.execute((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  }, selector);
  check(ok, `could not focus ${selector}`);
}

async function focusedTab() {
  return browser.execute(() => {
    const el = document.activeElement;
    return el?.getAttribute("role") === "tab" ? el.childNodes[0]?.textContent.trim() ?? "" : `${el?.tagName}.${el?.className}`;
  });
}

// Uncaught page errors are kept as evidence for the report.
async function watchPageErrors() {
  await browser.execute(() => {
    window.__pbE2eErrors = [];
    window.addEventListener("error", (e) => window.__pbE2eErrors.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__pbE2eErrors.push(`unhandled: ${String(e.reason)}`));
  });
}

async function pageErrors() {
  return browser.execute(() => window.__pbE2eErrors ?? []);
}

async function appAlive(what) {
  const alive = await browser.execute(
    () => document.getElementById("root").childElementCount > 0 && Boolean(document.getElementById("tab-library")),
  );
  check(alive, `app went blank ${what}; page errors: ${JSON.stringify(await pageErrors())}`);
}

// First-run indexing as a user does it: form shown, path typed, button
// enabled, click, then the scan's own status before the cards.
async function indexThroughForm() {
  await waitFor(
    "first-run form",
    () => browser.execute(() => Boolean(document.querySelector(".path-form input"))),
    30000,
  );
  await setInput(".path-form input", libraryDir);
  await waitFor(
    "enabled Index button",
    () =>
      browser.execute(() => {
        const button = document.querySelector('.path-form button[type="submit"]');
        return Boolean(button && !button.disabled);
      }),
    RESPONSIVE_MS,
  );
  await browser.$('.path-form button[type="submit"]').click();
  const status = await waitFor(
    "scan status",
    () => browser.execute(() => document.querySelector(".status")?.textContent.trim() || null),
    30000,
  );
  check(/^Indexed \d+ books/.test(status), `scan reported: ${status}`);
  return { status, ...(await waitTitles(ALL, 30000)) };
}

const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9;

// --- run --------------------------------------------------------------------

startWatchdog(480000);

const PDF_REL = "quillfeather-orbit-atlas.pdf";
const EPUB_REL = "Zephyr Lantern Field Notes.epub";
const BASALT_REL = "basalt-ledger-handbook.pdf";

try {
  await step("app binary and fixtures present", () => {
    check(existsSync(APP), `binary not found: ${APP} (build it first)`);
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    report.fixtures = [
      ...readdirSync(fixturesDir).map((name) => path.join(fixturesDir, name)),
      ...readdirSync(catalogFixtures).map((name) => path.join(catalogFixtures, name)),
    ]
      .sort()
      .map((file) => ({ name: path.relative(path.join(here, "fixtures"), file), sha256: sha256(file) }));
    check(report.fixtures.length === 7, `expected 3 books + 4 catalog profiles, found ${report.fixtures.length}`);
    return { app_sha256: report.app.sha256, fixtures: report.fixtures.length };
  });

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  libraryDir = path.join(tempRoot, "library");
  const dataDir = path.join(tempRoot, "data");
  const pdfPath = path.join(libraryDir, PDF_REL);
  const epubPath = path.join(libraryDir, EPUB_REL);

  await step("fresh isolated app-data and library copy", () => {
    cpSync(fixturesDir, libraryDir, { recursive: true });
    cpSync(catalogFixtures, path.join(libraryDir, "Catalog"), { recursive: true });
    writeFileSync(path.join(libraryDir, "hollow-reed.epub"), "");
    writeFileSync(path.join(libraryDir, "cracked-quartz.pdf"), "this is not a pdf\n");
    for (const d of ["data", "config", "cache", "state"]) mkdirSync(path.join(tempRoot, d));
    report.app_data_dir = dataDir;
    report.library_dir = libraryDir;
    return { root: tempRoot, fault: FAULT || null };
  });

  const env = {
    ...process.env,
    PB_E2E_RUN: RUN_ID,
    XDG_DATA_HOME: dataDir,
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "cache"),
    XDG_STATE_HOME: path.join(tempRoot, "state"),
  };
  await step("tauri-driver ready", () => startDriver(env));

  // ---- Session 1 ----------------------------------------------------------
  await step("launch packaged app: tab rail visible", launchApp);

  await step("embedded frontend (no dev server)", async () => {
    const origin = await browser.execute(() => window.location.origin);
    check(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin), `webview loaded a dev server origin: ${origin}`);
    return { origin };
  });

  await step("index synthetic library through the first-run form", async () => {
    const fresh = await invoke("get_library_state");
    check(fresh.library_path === null, `app-data not fresh: library_path=${fresh.library_path}`);
    return indexThroughForm();
  });

  await step("C4 linked catalog entries render once (no duplicate file cards)", async () => {
    const titles = await cardTitles();
    for (const fileTitle of LINKED_FILE_TITLES) check(!titles.includes(fileTitle), `linked file also shown as "${fileTitle}"`);
    for (const t of [PDF, BASALT]) check(titles.filter((x) => x === t).length === 1, `"${t}" not shown exactly once`);
    const atlas = await card(PDF);
    check(atlas.read.length === 1 && /^PDF/.test(atlas.state), `linked profile card ${JSON.stringify(atlas)}`);
    const missing = await card(MISSING);
    check(missing.badge === "File missing" && missing.read.length === 0, `missing-file card ${JSON.stringify(missing)}`);
    const wish = await card(WISH);
    check(wish.badge === "No local file" && wish.read.length === 0, `wishlist card ${JSON.stringify(wish)}`);
    await shot("01-library-grid");
    return { cards: titles.length, atlas, missing, wish };
  });

  await step("C3 shelf filters reflect catalog status", async () => {
    const seen = {
      // queued implies want-to-read; its file is absent, so it is wished for too
      wishlist: await chip("Wishlist", [WISH, MISSING]),
      up_next: await chip("Up next", [MISSING]),
      reading: await chip("Continue reading", [PDF]),
      finished: await chip("Finished", [BASALT]),
      on_shelf: await chip("On the shelf", [EPUB, PDF, BASALT, EMPTY, CORRUPT]),
      everything: await chip("Everything", ALL),
    };
    return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.titles]));
  });

  await step("C1/C4 open linked PDF profile from the grid: the linked file renders", async () => {
    await clickRead(PDF);
    const page = await pdfPage();
    check(page === "1", `PDF opened at page ${page}, expected 1`);
    const text = await pdfAt(1);
    check(text.includes("Quillfeather Orbit Atlas - page 1"), `wrong document rendered: ${text}`);
    check((await selectedTab()) === PDF, `selected tab ${await selectedTab()}`);
    return { page, text };
  });

  await step("C1 PDF paginates: Next, Previous, ArrowRight, page input, fit width", async () => {
    await browser.$('.reader-bar button[aria-label="Next page"]').click();
    await pdfAt(2);
    await browser.$('.reader-bar button[aria-label="Previous page"]').click();
    await pdfAt(1);
    await pressKeys("ArrowRight");
    await pdfAt(2);
    await setInput('.reader-bar input[aria-label="Page number"]', "3");
    const p3 = await pdfAt(3);
    const width = () => browser.execute(() => document.querySelector(".pdf-stage canvas")?.getBoundingClientRect().width ?? 0);
    const fitPage = await width();
    await browser.$('.reader-bar button[aria-label="Toggle zoom mode"]').click();
    const fitWidth = await waitFor("fit-width canvas wider", async () => {
      const w = await width();
      return w > fitPage + 1 ? w : null;
    }, RESPONSIVE_MS);
    check(
      (await browser.$('.reader-bar button[aria-label="Toggle zoom mode"]').getText()) === "Fit page",
      "zoom toggle did not switch to fit width",
    );
    await pressKeys("ArrowLeft");
    await pdfAt(2);
    await shot("02-pdf-page2-fit-width");
    return { p3, fit_page_px: Math.round(fitPage), fit_width_px: Math.round(fitWidth) };
  });

  await step("C2 PDF non-initial position written to its sidecar on disk", async () => {
    const value = await sidecarWhere(PDF_REL, (v) => v.position === "2", "PDF sidecar page 2");
    check(near(value.percent, 2 / 3), `PDF sidecar percent ${value.percent}`);
    const file = sidecarFile(PDF_REL);
    check(file.startsWith(path.join(libraryDir, ".properbooky", "state")), `sidecar outside the library: ${file}`);
    state.pdf = value;
    const ribbon = (await tabs()).find((t) => t.title === PDF);
    check(near(Number(ribbon.ribbon), 2 / 3) && ribbon.ribbonWidth === "67%", `ribbon ${JSON.stringify(ribbon)}`);
    return { file: path.relative(libraryDir, file), position: value.position, percent: value.percent, ribbon: ribbon.ribbonWidth };
  });

  await step("C1 open EPUB from the grid and paginate: Next, ArrowRight, ArrowLeft", async () => {
    await toLibrary();
    await clickRead(EPUB);
    await waitEpub();
    const opened = (await sidecarWhere(EPUB_REL, (v) => isCfi(v.position), "EPUB CFI saved on open", 15000)).position;
    await browser.$('.reader-bar button[aria-label="Next page"]').click();
    const second = (await sidecarWhere(EPUB_REL, (v) => isCfi(v.position) && v.position !== opened, "EPUB CFI after Next")).position;
    await pressKeys("ArrowRight");
    const third = (await sidecarWhere(EPUB_REL, (v) => isCfi(v.position) && v.position !== second && v.position !== opened, "EPUB CFI after ArrowRight")).position;
    await pressKeys("ArrowLeft");
    await sidecarWhere(EPUB_REL, (v) => v.position === second, "EPUB back to the previous page after ArrowLeft");
    check((await selectedTab()) === EPUB, "EPUB tab not selected");
    return { opened, second, third };
  });

  await step("C2/C3 EPUB percent recorded and shown on its ribbon", async () => {
    const value = await sidecarWhere(
      EPUB_REL,
      (v) => isCfi(v.position) && typeof v.percent === "number" && v.percent > 0 && v.percent < 1,
      "EPUB percent from generated locations",
      30000,
    );
    const ribbon = (await tabs()).find((t) => t.title === EPUB);
    check(near(Number(ribbon.ribbon), value.percent), `ribbon ${ribbon.ribbon} vs sidecar ${value.percent}`);
    check(ribbon.ribbonWidth === `${Math.round(value.percent * 100)}%`, `ribbon width ${ribbon.ribbonWidth}`);
    state.epub = value;
    await shot("03-epub-two-tabs");
    return { position: value.position, percent: value.percent, ribbon: ribbon.ribbonWidth };
  });

  await step("C2 close EPUB tab and reopen: exact position, percent kept", async () => {
    await browser.$(`.tab-close[aria-label="Close ${EPUB}"]`).click();
    check(!(await tabs()).some((t) => t.title === EPUB), "EPUB tab still open after close");
    check((await selectedTab()) === "Library", "closing the active tab did not return to Library");
    markSidecar(EPUB_REL);
    await clickRead(EPUB);
    // The ribbon starts from the stored percent before the reader reports.
    const early = (await tabs()).find((t) => t.title === EPUB);
    await waitEpub();
    const reopened = await rewrittenSidecar(EPUB_REL, "reopened EPUB reported its location");
    check(reopened.position === state.epub.position, `EPUB reopened at ${reopened.position}, expected ${state.epub.position}`);
    check(near(reopened.percent, state.epub.percent), `EPUB percent ${reopened.percent} after reopen, expected ${state.epub.percent} (must not be erased)`);
    check(near(Number(early.ribbon), state.epub.percent), `reopened ribbon started at ${early.ribbon}`);
    return { position: reopened.position, percent: reopened.percent, ribbon_at_open: early.ribbonWidth };
  });

  await step("C3 grid progress and Continue reading reflect sidecar state", async () => {
    await toLibrary();
    const epubCard = await card(EPUB);
    check(epubCard.progress === String(Math.round(state.epub.percent * 100)), `EPUB card progress ${epubCard.progress}`);
    check(epubCard.state.includes(`${Math.round(state.epub.percent * 100)}% read`), `EPUB card text ${epubCard.state}`);
    const atlasCard = await card(PDF);
    check(atlasCard.progress === "67", `linked PDF card progress ${atlasCard.progress}`);
    const reading = await chip("Continue reading", [PDF, EPUB]);
    await shot("04-continue-reading");
    await chip("Everything", ALL);
    return { epub: epubCard.progress, pdf: atlasCard.progress, continue_reading: reading.titles };
  });

  await step("C3 keyboard: arrows move along the tab rail, Enter opens, Delete closes", async () => {
    // Tab order is [Library, PDF, EPUB]; Library is active.
    await focus("#tab-library");
    await pressKeys("ArrowRight");
    check((await focusedTab()) === PDF, `ArrowRight focused ${await focusedTab()}`);
    check((await selectedTab()) === "Library", "focus move activated a tab");
    await pressKeys("Enter");
    await pdfAt(2);
    check((await selectedTab()) === PDF, "Enter did not open the focused tab");
    // An arrow on the tab rail moves focus; it must not turn the page.
    await focus(`#${(await tabs()).find((t) => t.title === PDF).id}`);
    await pressKeys("ArrowRight");
    check((await focusedTab()) === EPUB, `ArrowRight focused ${await focusedTab()}`);
    check((await pdfPage()) === "2", "arrow on the tab rail turned the PDF page");
    await pressKeys("End");
    check((await focusedTab()) === EPUB, "End did not focus the last tab");
    await pressKeys("Home");
    check((await focusedTab()) === "Library", "Home did not focus Library");
    await pressKeys("ArrowLeft");
    check((await focusedTab()) === EPUB, "ArrowLeft did not wrap to the last tab");
    await pressKeys("Delete");
    await waitFor("EPUB tab closed by Delete", async () => !(await tabs()).some((t) => t.title === EPUB), RESPONSIVE_MS);
    const afterDelete = await focusedTab();
    check(afterDelete === PDF, `after Delete focus is on ${afterDelete}, expected the active tab`);
    check((await pdfPage()) === "2", "Delete changed the PDF page");
    // Close the active tab with its keyboard-focused close button.
    await focus(`.tab-close[aria-label="Close ${PDF}"]`);
    await pressKeys("Enter");
    await waitFor("PDF tab closed", async () => !(await tabs()).some((t) => t.title === PDF), RESPONSIVE_MS);
    const afterClose = await focusedTab();
    check(afterClose === "Library", `after closing the active tab focus is on ${afterClose}`);
    check((await selectedTab()) === "Library", "Library not selected after closing the active tab");
    await shot("05-keyboard-closed");
    return { after_delete: afterDelete, after_close: afterClose };
  });

  await step("rapid tab switching and closing writes nothing to the wrong book", async () => {
    await watchPageErrors();
    const before = { pdf: readSidecar(PDF_REL), epub: readSidecar(EPUB_REL) };
    // Leave the EPUB tab while epub.js is still opening/displaying (this
    // blanked the whole app before the fix), at varying delays.
    for (let i = 0; i < 10; i++) {
      await clickRead(EPUB);
      await new Promise((r) => setTimeout(r, 15 * (i % 5)));
      await browser.$("#tab-library").click();
      await new Promise((r) => setTimeout(r, 150));
      await appAlive(`after leaving a loading EPUB (iteration ${i + 1})`);
    }
    await browser.$(`.tab-close[aria-label="Close ${EPUB}"]`).click();
    await toLibrary();
    await clickRead(PDF);
    await toLibrary();
    await clickRead(EPUB);
    for (let i = 0; i < 12; i++) {
      await browser.execute((n) => document.querySelectorAll(".tab-list .tab-title")[n % 2]?.click(), i);
    }
    // Close the EPUB tab while it may still be loading, then flip again.
    await browser.$(`.tab-close[aria-label="Close ${EPUB}"]`).click();
    await clickRead(EPUB).catch(async () => {
      await toLibrary();
      await clickRead(EPUB);
    });
    await browser.execute(() => document.querySelectorAll(".tab-list .tab-title")[0]?.click());
    await pdfAt(2);
    await browser.execute(() => document.querySelectorAll(".tab-list .tab-title")[1]?.click());
    await waitEpub();
    // Let any in-flight saves land, then compare positions.
    await new Promise((r) => setTimeout(r, 1500));
    const after = { pdf: readSidecar(PDF_REL), epub: readSidecar(EPUB_REL) };
    check(after.pdf.position === before.pdf.position, `PDF position moved ${before.pdf.position} -> ${after.pdf.position}`);
    check(after.epub.position === before.epub.position, `EPUB position moved ${before.epub.position} -> ${after.epub.position}`);
    check(near(after.epub.percent, before.epub.percent), `EPUB percent ${before.epub.percent} -> ${after.epub.percent}`);
    check(!(await readerError()), "reader error after rapid switching");
    await appAlive("after rapid switching");
    for (const t of [PDF, EPUB]) await browser.$(`.tab-close[aria-label="Close ${t}"]`).click();
    check((await tabs()).length === 1, "tabs left open");
    report.page_errors_rapid_switching = await pageErrors();
    return { pdf: after.pdf.position, epub: after.epub.position, page_errors: report.page_errors_rapid_switching.length };
  });

  await step("C1 failure: corrupt PDF and 0-byte EPUB show an actionable error", async () => {
    const digest = stateDigest();
    await clickRead(CORRUPT);
    const corrupt = await waitFor("corrupt PDF error", readerError, 20000);
    check(/Couldn't open this book: .*Invalid PDF/.test(corrupt), corrupt);
    await browser.$(`.tab-close[aria-label="Close ${CORRUPT}"]`).click();
    await clickRead(EMPTY);
    const empty = await waitFor("0-byte EPUB error", readerError, 20000);
    check(/Couldn't open this book: .*empty/.test(empty), empty);
    await shot("06-empty-epub-error");
    await browser.$(`.tab-close[aria-label="Close ${EMPTY}"]`).click();
    check(JSON.stringify(stateDigest()) === JSON.stringify(digest), "failed opens changed reading state");
    await waitTitles(ALL);
    return { corrupt, empty };
  });

  await step("failure: unwritable sidecar is reported, reading continues, recovers", async () => {
    await clickRead(BASALT);
    await pdfAt(1);
    await browser.$('.reader-bar button[aria-label="Next page"]').click();
    await sidecarWhere(BASALT_REL, (v) => v.position === "2", "Basalt sidecar page 2");
    await browser.$(`.tab-close[aria-label="Close ${BASALT}"]`).click();
    const file = sidecarFile(BASALT_REL);
    rmSync(file);
    mkdirSync(file); // a directory where the sidecar belongs: unreadable and unwritable, even as root
    await clickRead(BASALT);
    await pdfAt(1);
    const loadNotice = await waitFor("load failure notice", async () => {
      const n = await notice();
      return n && /could not be loaded/.test(n) ? n : null;
    }, RESPONSIVE_MS);
    await browser.$('.reader-bar button[aria-label="Next page"]').click();
    await pdfAt(2);
    const saveNotice = await waitFor("save failure notice", async () => {
      const n = await notice();
      return n && /not being saved/.test(n) ? n : null;
    }, RESPONSIVE_MS);
    check(statSync(file).isDirectory(), "obstruction removed by a failed write");
    await shot("07-unwritable-sidecar-notice");
    rmSync(file, { recursive: true });
    await browser.$('.reader-bar button[aria-label="Previous page"]').click();
    await pdfAt(1);
    await sidecarWhere(BASALT_REL, (v) => v.position === "1", "Basalt sidecar written after recovery");
    await waitFor("save notice cleared after a successful save", async () => !/not being saved/.test((await notice()) ?? ""), RESPONSIVE_MS);
    await browser.$(`.tab-close[aria-label="Close ${BASALT}"]`).click();
    return { load_notice: loadNotice, save_notice: saveNotice };
  });

  await step("failure: corrupt sidecar is set aside byte-for-byte, never overwritten", async () => {
    const file = sidecarFile(BASALT_REL);
    const corrupt = '{"position": "2", "highlights": [ {"id": "keep-me", "text": "synthetic quote"';
    writeFileSync(file, corrupt);
    await clickRead(BASALT);
    await pdfAt(1);
    const message = await waitFor("corrupt sidecar notice", notice, RESPONSIVE_MS);
    check(/could not be read/.test(message), message);
    const kept = readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.unreadable-`));
    check(kept.length === 1, `set-aside files: ${JSON.stringify(kept)}`);
    check(readFileSync(path.join(path.dirname(file), kept[0]), "utf8") === corrupt, "set-aside bytes differ");
    check(message.includes(kept[0]), "notice does not name the preserved file");
    const fresh = await sidecarWhere(BASALT_REL, (v) => v.position === "1", "fresh Basalt sidecar");
    await shot("08-corrupt-sidecar-notice");
    await browser.$(`.tab-close[aria-label="Close ${BASALT}"]`).click();
    return { kept: kept[0], notice: message, fresh_position: fresh.position };
  });

  await step("close app (session 1)", closeApp);

  if (FAULT === "lost-position") rmSync(sidecarFile(PDF_REL));

  // ---- Session 2: restart the same binary on the same app-data ------------
  await step("relaunch same packaged binary", launchApp);

  await step("C2 library and progress persisted across restart", async () => {
    const libraryState = await invoke("get_library_state");
    check(libraryState.library_path === libraryDir, `library_path=${libraryState.library_path}`);
    await waitTitles(ALL, 30000);
    const reading = await chip("Continue reading", [PDF, EPUB]);
    await chip("Everything", ALL);
    return { continue_reading: reading.titles };
  });

  await step("C2 PDF reopens at the exact saved page after restart", async () => {
    await clickRead(PDF);
    const page = await pdfPage();
    check(page === state.pdf.position, `PDF restored at page ${page}, expected ${state.pdf.position}`);
    const text = await pdfAt(Number(page));
    const ribbon = (await tabs()).find((t) => t.title === PDF);
    check(near(Number(ribbon.ribbon), state.pdf.percent), `PDF ribbon ${ribbon.ribbon} after restart`);
    return { page, text, ribbon: ribbon.ribbonWidth };
  });

  await step("C2 EPUB reopens at the exact saved CFI after restart", async () => {
    await toLibrary();
    markSidecar(EPUB_REL);
    await clickRead(EPUB);
    await waitEpub();
    const reopened = await rewrittenSidecar(EPUB_REL, "EPUB reported its location after restart");
    check(reopened.position === state.epub.position, `EPUB restored at ${reopened.position}, expected ${state.epub.position}`);
    check(near(reopened.percent, state.epub.percent), `EPUB percent ${reopened.percent}, expected ${state.epub.percent}`);
    await shot("09-restart-restored");
    return { position: reopened.position, percent: reopened.percent };
  });

  await step("close app (session 2)", closeApp);

  // ---- Session 3: index rebuild from empty app-data -------------------------
  let digestBeforeRebuild = null;
  await step("rebuild index: delete app-data only", () => {
    const removed = listTree(dataDir);
    check(removed.some((f) => f.path.endsWith("library.db")), `no index in app-data: ${JSON.stringify(removed)}`);
    check(!removed.some((f) => f.path.endsWith(".json")), "reading state found in app-data");
    digestBeforeRebuild = stateDigest();
    rmSync(dataDir, { recursive: true });
    mkdirSync(dataDir);
    return { removed: removed.map((f) => f.path) };
  });

  await step("relaunch on empty app-data and re-index the same folder", async () => {
    await launchApp();
    const fresh = await invoke("get_library_state");
    check(fresh.library_path === null, `index not rebuilt from scratch: ${fresh.library_path}`);
    const indexed = await indexThroughForm();
    check(JSON.stringify(stateDigest()) === JSON.stringify(digestBeforeRebuild), "re-indexing rewrote reading state");
    return { ...indexed, sidecars_unchanged: digestBeforeRebuild.length };
  });

  await step("C2 positions survive the index rebuild", async () => {
    await clickRead(PDF);
    const page = await pdfPage();
    check(page === state.pdf.position, `PDF at page ${page} after index rebuild, expected ${state.pdf.position}`);
    await toLibrary();
    markSidecar(EPUB_REL);
    await clickRead(EPUB);
    await waitEpub();
    const reopened = await rewrittenSidecar(EPUB_REL, "EPUB location after index rebuild");
    check(reopened.position === state.epub.position, `EPUB at ${reopened.position} after index rebuild, expected ${state.epub.position}`);
    return { pdf: page, epub: reopened.position };
  });

  await step("C2 positions survive an in-app Rescan", async () => {
    await toLibrary();
    await browser.execute(() => Array.from(document.querySelectorAll(".toolbar button")).find((b) => b.textContent === "Rescan").click());
    await waitFor("rescan status", () => browser.execute(() => /Indexed \d+ books/.test(document.querySelector(".status")?.textContent ?? "")), 30000);
    await waitTitles(ALL);
    const reading = await chip("Continue reading", [PDF, EPUB]);
    await chip("Everything", ALL);
    await browser.execute(() => document.querySelectorAll(".tab-list .tab-title")[0]?.click());
    const page = await pdfPage();
    check(page === state.pdf.position, `PDF at page ${page} after rescan`);
    const value = readSidecar(EPUB_REL);
    check(value.position === state.epub.position, `EPUB sidecar ${value.position} after rescan`);
    await shot("10-after-index-rebuild");
    return { pdf: page, epub: value.position, continue_reading: reading.titles };
  });

  await step("close app (session 3)", closeApp);

  await step("reading state lives only in the library folder", () => {
    const appData = listTree(dataDir).map((f) => f.path);
    check(!appData.some((p) => p.endsWith(".json")), `JSON state in app-data: ${JSON.stringify(appData)}`);
    const sidecars = readdirSync(path.join(libraryDir, ".properbooky/state"));
    const final = { pdf: readSidecar(PDF_REL), epub: readSidecar(EPUB_REL) };
    check(final.pdf.position === state.pdf.position && final.epub.position === state.epub.position, "final sidecars differ");
    report.sidecars = { pdf: final.pdf, epub: final.epub, files: sidecars };
    return { app_data: appData, sidecars };
  });

  stopWatchdog();
  await finish(0, "pass");
} catch {
  stopWatchdog();
  await finish(1, "fail");
}
