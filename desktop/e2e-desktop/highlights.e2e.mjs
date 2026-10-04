// PBK-26 desktop highlights and export journey, packaged: drives the built
// ProperBooky binary (tauri-driver/WebKitWebDriver, harness.mjs) with real
// pointer drags over the EPUB book frame and the PDF text layer, the
// highlight pill, painted marks, the highlights panel (keyboard too) and the
// Obsidian export, against a temp copy of the committed synthetic fixtures
// (repeated phrases across lines, pages and chapters), fresh app-data and a
// temp vault. Sidecars and export notes are asserted on disk across tab
// reopen, restart, index rebuild and injected sidecar failures.
//
// Usage (Linux, inside an X server or `xvfb-run -a`):
//   E2E_APP=/path/to/desktop node e2e-desktop/highlights.e2e.mjs
// Environment as in harness.mjs; default whole-run watchdog 480000ms.
//   E2E_FAULT=lost-tombstone  delete the EPUB sidecar's tombstone between
//                             sessions; the "removal stays removed" restart
//                             assertion must fail (verify-failures).

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
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

const highlightFixtures = path.join(here, "fixtures", "highlights");

const EPUB = "Zephyr Lantern Field Notes";
const PDF = "Tidewater Echo Ledger"; // catalog profile linked to the PDF
const ALL = [EPUB, PDF, "basalt ledger handbook", "quillfeather orbit atlas"].sort();
const PHRASE = "the tide returns the ledger";
const EPUB_REL = "Zephyr Lantern Field Notes.epub";
const PDF_REL = "tidewater-echo-ledger.pdf";

let libraryDir = null;
let vaultDir = null;
const saved = {};

// --- disk ---------------------------------------------------------------------

function sidecarFile(relative) {
  const registry = JSON.parse(readFileSync(path.join(libraryDir, ".properbooky/identities.json"), "utf8"));
  const record = registry.records.findLast((r) => r.path === relative);
  check(record?.state_file, `no state file registered for ${relative}`);
  return path.join(libraryDir, ".properbooky/state", record.state_file);
}

function highlightsOnDisk(relative) {
  const file = sidecarFile(relative);
  if (!existsSync(file) || !statSync(file).isFile()) return [];
  return JSON.parse(readFileSync(file, "utf8")).highlights ?? [];
}

const live = (relative) => highlightsOnDisk(relative).filter((h) => !h.deleted);

async function newHighlight(relative, before, what) {
  return waitFor(
    what,
    async () => {
      const found = highlightsOnDisk(relative).filter((h) => !before.includes(h.id));
      return found.length === 1 ? found[0] : null;
    },
    RESPONSIVE_MS,
  );
}

const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

// --- UI -----------------------------------------------------------------------

const shot = (name) => browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));

async function clickRead(title) {
  let seen = null;
  try {
    await waitFor(
      `Read on "${title}"`,
      async () => {
        seen = await browser.execute((t) => {
          const card = Array.from(document.querySelectorAll(".grid .card")).find(
            (c) => c.querySelector("h2")?.textContent.trim() === t,
          );
          const buttons = card ? card.querySelectorAll(".read-book") : [];
          if (buttons.length === 1) buttons[0].click();
          return card ? buttons.length : null;
        }, title);
        return seen === 1;
      },
      RESPONSIVE_MS,
    );
  } catch {
    throw new Error(`card "${title}" has ${seen ?? "no card and"} Read buttons, expected exactly 1`);
  }
}

async function toLibrary() {
  await browser.$("#tab-library").click();
  await waitTitles(ALL);
}

async function closeTab(title) {
  await browser.$(`.tab-close[aria-label="Close ${title}"]`).click();
}

/** Real pointer drag across a text range, at mid-height of its first line. */
async function drag(rect) {
  await browser
    .action("pointer")
    .move({ x: Math.round(rect.x1), y: Math.round(rect.y) })
    .down()
    .move({ x: Math.round(rect.x2), y: Math.round(rect.y), duration: 150 })
    .up()
    .perform();
}

async function pillText() {
  return waitFor(
    "highlight pill",
    () => browser.execute(() => document.querySelector(".highlight-pill .highlight-pill-text")?.textContent ?? null),
    RESPONSIVE_MS,
  );
}

async function pressHighlight() {
  await browser.$(".highlight-pill").$("button=Highlight").click();
}

async function notices() {
  return browser.execute(() => Array.from(document.querySelectorAll(".reader-notice")).map((n) => n.textContent.trim()).join(" | "));
}

async function openPanel() {
  if (!(await browser.$(".highlights-panel").isExisting())) await browser.$('button[aria-label="Show highlights"]').click();
  await browser.$(".highlights-panel").waitForExist({ timeout: RESPONSIVE_MS });
}

async function closePanel() {
  if (await browser.$(".highlights-panel").isExisting()) await browser.$('button[aria-label="Close highlights"]').click();
}

async function panelRows() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".highlights-panel li")).map((li) => ({
      quote: li.querySelector(".highlight-jump")?.textContent.trim(),
      location: li.querySelector(".highlight-row-meta span")?.textContent.trim(),
      note: li.querySelector(".highlight-note")?.textContent.trim() ?? null,
    })),
  );
}

async function panelButton(quoteText, label) {
  const index = await browser.execute(
    (q) => Array.from(document.querySelectorAll(".highlights-panel li")).findIndex((li) => li.querySelector(".highlight-jump")?.textContent.trim() === q),
    quoteText,
  );
  check(index >= 0, `no panel row for "${quoteText}"`);
  const rows = await browser.$$(".highlights-panel li");
  return label === "jump" ? rows[index].$(".highlight-jump") : rows[index].$(`button=${label}`);
}

// PDF -------------------------------------------------------------------------

async function pdfAt(page) {
  await waitFor(`PDF page ${page}`, async () => (await pdfPage()) === String(page), RESPONSIVE_MS);
  await waitFor(
    `PDF page ${page} text layer`,
    () => browser.execute((p) => (document.querySelector(".textLayer")?.textContent ?? "").includes(`page ${p}`), page),
    RESPONSIVE_MS,
  );
}

async function pdfGo(page) {
  await pdfPage(); // the page box accepts a number only once "of N" is known
  await setInput('.reader-bar input[aria-label="Page number"]', String(page));
  await pdfAt(page);
}

/** Rect of `phrase` inside the text-layer line that starts with `lineStart`. */
async function pdfPhraseRect(lineStart, phrase) {
  const rect = await browser.execute(
    (start, text) => {
      const span = Array.from(document.querySelectorAll(".textLayer span")).find((s) => s.textContent.startsWith(start));
      if (!span) return null;
      const node = span.firstChild;
      const i = node.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + text.length);
      const r = range.getBoundingClientRect();
      const line = span.getBoundingClientRect();
      return { x1: r.left + 1, x2: r.right - 1, y: r.top + r.height / 2, top: line.top, bottom: line.bottom };
    },
    lineStart,
    phrase,
  );
  check(rect, `no PDF line starting "${lineStart}"`);
  return rect;
}

/** Each painted rect, with the text-layer line it sits on. */
async function pdfMarks() {
  return browser.execute(() => {
    const lines = Array.from(document.querySelectorAll(".textLayer span")).map((s) => ({ text: s.textContent, r: s.getBoundingClientRect() }));
    return Array.from(document.querySelectorAll(".pdf-highlight")).map((m) => {
      const r = m.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      const line = lines.find((l) => mid >= l.r.top && mid <= l.r.bottom);
      return { line: line?.text ?? null, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    });
  });
}

async function marksOnLines(expected, what) {
  let marks = [];
  try {
    await waitFor(
      what,
      async () => {
        marks = await pdfMarks();
        const lines = [...new Set(marks.map((m) => m.line))].sort();
        return JSON.stringify(lines) === JSON.stringify([...expected].sort());
      },
      RESPONSIVE_MS,
    );
  } catch {
    throw new Error(`${what}: painted on ${JSON.stringify(marks.map((m) => m.line))}, expected ${JSON.stringify(expected)}`);
  }
  return marks;
}

/** Width of a text-layer line as a share of the rendered page width. */
async function lineShare(lineText) {
  return browser.execute((t) => {
    const page = document.querySelector(".pdf-stage canvas").getBoundingClientRect().width;
    const span = Array.from(document.querySelectorAll(".textLayer span")).find((s) => s.textContent === t);
    return span ? span.getBoundingClientRect().width / page : -1;
  }, lineText);
}

/** Ground truth from the fixture itself: pdf.js's text-item width / page width. */
async function truthShare(pageNumber, lineText) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(readFileSync(path.join(highlightFixtures, PDF_REL))) });
  const doc = await task.promise;
  const page = await doc.getPage(pageNumber);
  const item = (await page.getTextContent()).items.find((i) => i.str === lineText);
  const share = item.width / page.getViewport({ scale: 1 }).width;
  await task.destroy();
  return share;
}

/** The page's canonical text (pdf.js text items, as the reader indexes it). */
async function pdfPageText() {
  return browser.execute(() => {
    const layer = document.querySelector(".textLayer");
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) text += n.textContent;
    return text;
  });
}

// EPUB ------------------------------------------------------------------------

async function waitEpub() {
  await waitFor(
    "EPUB rendered",
    async () => {
      const error = await readerError();
      if (error) throw new Error(`reader error: ${error}`);
      return browser.execute(() => Boolean(document.querySelector(".reader iframe")) && !document.querySelector(".reader-loading"));
    },
    45000,
  );
}

/** Rect (app coordinates) of `phrase` in the n-th fully visible paragraph. */
async function epubPhraseRect(nth, phrase) {
  const rect = await browser.execute(
    (n, text) => {
      const iframe = document.querySelector(".reader iframe");
      const doc = iframe.contentDocument;
      const frame = iframe.getBoundingClientRect();
      // epub.js pages by scrolling a wide iframe inside a clipped container:
      // what the reader sees is the container's box, not the iframe's.
      const view = document.querySelector(".reader-page").getBoundingClientRect();
      const visible = Array.from(doc.querySelectorAll("p")).filter((p) => {
        const r = p.getBoundingClientRect();
        return frame.left + r.left >= view.left && frame.left + r.right <= view.right && frame.top + r.top >= view.top && frame.top + r.bottom <= view.bottom;
      });
      const p = visible[n];
      if (!p) return null;
      const node = p.firstChild;
      const i = node.textContent.indexOf(text);
      const range = doc.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + text.length);
      const r = range.getBoundingClientRect();
      return {
        paragraph: p.textContent.slice(0, p.textContent.indexOf(".")),
        x1: frame.left + r.left + 1,
        x2: frame.left + r.right - 1,
        y: frame.top + r.top + r.height / 2,
        top: frame.top + r.top,
        bottom: frame.top + r.bottom,
        left: frame.left + r.left,
        right: frame.left + r.right,
      };
    },
    nth,
    phrase,
  );
  check(rect, `no visible paragraph #${nth} with "${phrase}"`);
  return rect;
}

async function epubMarks() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".reader g.pb-highlight")).map((g) => {
      const r = g.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: r.width };
    }),
  );
}

/** Which visible paragraph a painted mark covers (by geometry). */
async function epubMarkParagraphs() {
  return browser.execute(() => {
    const iframe = document.querySelector(".reader iframe");
    const doc = iframe.contentDocument;
    const frame = iframe.getBoundingClientRect();
    const view = document.querySelector(".reader-page").getBoundingClientRect();
    const paragraphs = Array.from(doc.querySelectorAll("p")).map((p) => {
      const r = p.getBoundingClientRect();
      return { label: p.textContent.slice(0, p.textContent.indexOf(".")), top: frame.top + r.top, bottom: frame.top + r.bottom, left: frame.left + r.left, right: frame.left + r.right };
    });
    return Array.from(document.querySelectorAll(".reader g.pb-highlight")).map((g) => {
      const r = g.getBoundingClientRect();
      if (r.width < 1) return null;
      const x = (r.left + r.right) / 2;
      const y = (r.top + r.bottom) / 2;
      // Only marks on the page currently shown (other columns are clipped).
      if (x < view.left || x > view.right || y < view.top || y > view.bottom) return null;
      return paragraphs.find((p) => x >= p.left && x <= p.right && y >= p.top && y <= p.bottom)?.label ?? "outside any paragraph";
    }).filter(Boolean);
  });
}

async function epubMarksOn(expected, what, timeout = 15000) {
  let seen = [];
  try {
    await waitFor(
      what,
      async () => {
        seen = await epubMarkParagraphs();
        return JSON.stringify([...seen].sort()) === JSON.stringify([...expected].sort());
      },
      timeout,
    );
  } catch {
    throw new Error(`${what}: marks over ${JSON.stringify(seen)}, expected ${JSON.stringify(expected)}`);
  }
  return seen;
}

// Export ----------------------------------------------------------------------

function exportDir() {
  return path.join(vaultDir, "Properbooky");
}

function exportFiles() {
  const dir = exportDir();
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function exportText(name) {
  return readFileSync(path.join(exportDir(), name), "utf8");
}

async function syncExport() {
  await toLibrary();
  await browser.execute(() => Array.from(document.querySelectorAll(".toolbar button")).find((b) => b.textContent === "Obsidian").click());
  await browser.$(".acquire-panel").waitForExist({ timeout: RESPONSIVE_MS });
  await setInput('.acquire-panel input[type="text"]', vaultDir);
  await browser.$(".acquire-panel").$("button*=Sync highlights").click();
  const text = await waitFor(
    "export report",
    () => browser.execute(() => document.querySelector(".acquire-report")?.textContent.trim() || document.querySelector(".acquire-panel .status")?.textContent.trim() || null),
    20000,
  );
  check(/^Exported \d+ highlights/.test(text), `export said: ${text}`);
  const skipped = await browser.execute(() => Array.from(document.querySelectorAll('.acquire-panel ul[aria-label="Not exported"] li')).map((l) => l.textContent));
  await browser.$('.acquire-panel button[aria-label="Close"]').click();
  return { text, skipped };
}

function treeDigest(dir) {
  return listTree(dir).map((f) => `${f.path}:${sha256(path.join(dir, f.path))}`).sort();
}

// --- run ----------------------------------------------------------------------

startWatchdog(480000);

try {
  await step("app binary and fixtures present", () => {
    check(existsSync(APP), `binary not found: ${APP} (build it first)`);
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    const files = [
      ...readdirSync(fixturesDir).map((n) => path.join(fixturesDir, n)),
      path.join(highlightFixtures, PDF_REL),
      path.join(highlightFixtures, "catalog", "Tidewater Echo Ledger.md"),
    ];
    report.fixtures = files.map((f) => ({ name: path.relative(path.join(here, "fixtures"), f), sha256: sha256(f) }));
    check(report.fixtures.length === 5, `expected 5 fixtures, found ${report.fixtures.length}`);
    return { app_sha256: report.app.sha256, fixtures: report.fixtures.length };
  });

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  libraryDir = path.join(tempRoot, "library");
  vaultDir = path.join(tempRoot, "vault");
  const dataDir = path.join(tempRoot, "data");

  await step("fresh isolated app-data and library copy", () => {
    cpSync(fixturesDir, libraryDir, { recursive: true });
    cpSync(path.join(highlightFixtures, PDF_REL), path.join(libraryDir, PDF_REL));
    mkdirSync(path.join(libraryDir, "Catalog"));
    cpSync(path.join(highlightFixtures, "catalog", "Tidewater Echo Ledger.md"), path.join(libraryDir, "Catalog", "Tidewater Echo Ledger.md"));
    // A disposable "vault" with a note of the user's own that must survive.
    mkdirSync(path.join(vaultDir, "Daily"), { recursive: true });
    writeFileSync(path.join(vaultDir, "Daily", "2026-10-04.md"), "# My day\nRead about tides.\n");
    for (const d of ["data", "config", "cache", "state"]) mkdirSync(path.join(tempRoot, d));
    report.app_data_dir = dataDir;
    report.library_dir = libraryDir;
    report.vault_dir = vaultDir;
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

  const indexLibrary = async () => {
    const fresh = await invoke("get_library_state");
    check(fresh.library_path === null, `app-data not fresh: ${fresh.library_path}`);
    await waitFor("first-run form", () => browser.execute(() => Boolean(document.querySelector(".path-form input"))), 30000);
    await setInput(".path-form input", libraryDir);
    await waitFor(
      "enabled Index button",
      () => browser.execute(() => document.querySelector('.path-form button[type="submit"]')?.disabled === false),
      RESPONSIVE_MS,
    );
    await browser.$('.path-form button[type="submit"]').click();
    return waitTitles(ALL, 30000);
  };

  // ---- Session 1 ---------------------------------------------------------------
  await step("launch packaged app: tab rail visible", launchApp);

  await step("embedded frontend (no dev server)", async () => {
    const origin = await browser.execute(() => window.location.origin);
    check(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin), `webview loaded a dev server origin: ${origin}`);
    return { origin };
  });

  await step("index synthetic library through the first-run form", indexLibrary);

  await step("P1 PDF: drag-select the 2nd repeat on page 2 -> pill -> highlight on that exact line", async () => {
    await clickRead(PDF);
    await pdfAt(1);
    await pdfGo(2);
    const target = await pdfPhraseRect("South pier", PHRASE);
    await drag(target);
    const pill = await pillText();
    check(pill.includes(PHRASE), `pill shows ${pill}`);
    await pressHighlight();
    const h = await newHighlight(PDF_REL, [], "PDF highlight on disk");
    const marks = await marksOnLines([`South pier: ${PHRASE} after the storm.`], "painted on the South pier line only");
    const text = await pdfPageText();
    const a = h.anchor;
    check(a.type === "pdf" && a.page === 2, `anchor ${JSON.stringify(a)}`);
    check(a.quote.exact === PHRASE, `quote ${a.quote.exact}`);
    check(a.quote.prefix.endsWith("South pier: ") && a.quote.suffix.startsWith(" after the storm."), `context ${JSON.stringify(a.quote)}`);
    check(text.slice(a.position.start, a.position.end) === PHRASE, `position ${JSON.stringify(a.position)} -> "${text.slice(a.position.start, a.position.end)}"`);
    check(text.indexOf(PHRASE) < a.position.start, "position is the first occurrence, not the selected one");
    check(isUuid(h.id) && h.created_at === h.updated_at && h.deleted === false, `record ${JSON.stringify(h)}`);
    saved.pdfSouth = h;
    await shot("01-pdf-south-pier-highlight");
    return { id: h.id, anchor: a, marks };
  });

  await step("P1 PDF: second highlight on page 1's 2nd repeat (Evening entry)", async () => {
    await pdfGo(1);
    await drag(await pdfPhraseRect("Evening entry", PHRASE));
    await pillText();
    await pressHighlight();
    const h = await newHighlight(PDF_REL, [saved.pdfSouth.id], "second PDF highlight on disk");
    check(h.anchor.page === 1 && h.anchor.quote.prefix.endsWith("Evening entry: "), `anchor ${JSON.stringify(h.anchor)}`);
    await marksOnLines([`Evening entry: ${PHRASE} at last light.`], "painted on the Evening line only");
    saved.pdfEvening = h;
    return { id: h.id };
  });

  await step("P2 PDF: page switch and fit-width vs fit-page keep the exact lines", async () => {
    await pdfGo(3);
    check((await pdfMarks()).length === 0, "page 3 shows marks from other pages");
    await pdfGo(2);
    const fitPage = await marksOnLines([`South pier: ${PHRASE} after the storm.`], "page 2 after switching back");
    const pageWidth = () => browser.execute(() => document.querySelector(".pdf-stage canvas").getBoundingClientRect().width);
    const narrow = await pageWidth();
    const fitPageLine = await lineShare(`South pier: ${PHRASE} after the storm.`);
    await browser.$('.reader-bar button[aria-label="Toggle zoom mode"]').click();
    let latest = [];
    let wide = 0;
    try {
      await waitFor(
        "fit-width re-render",
        async () => {
          wide = await pageWidth();
          latest = await pdfMarks();
          const scale = wide / narrow;
          const width = (m) => m.right - m.left;
          return scale > 1.2 && latest.length && Math.abs(width(latest[0]) / width(fitPage[0]) - scale) < 0.1;
        },
        RESPONSIVE_MS,
      );
    } catch {
      throw new Error(`fit width: page ${narrow}px -> ${wide}px, marks ${JSON.stringify(latest)} (fit page ${JSON.stringify(fitPage)})`);
    }
    const fitWidth = latest;
    check(fitWidth.every((m) => m.line === `South pier: ${PHRASE} after the storm.`), `fit width: ${JSON.stringify(fitWidth)}`);
    // Selectable text matches the rendered glyphs in both zoom modes: the
    // line's share of the page equals pdf.js's own measurement of the item.
    const truth = await truthShare(2, `South pier: ${PHRASE} after the storm.`);
    const fitWidthLine = await lineShare(`South pier: ${PHRASE} after the storm.`);
    for (const [mode, share] of [["fit page", fitPageLine], ["fit width", fitWidthLine]]) {
      check(Math.abs(share - truth) < 0.01, `${mode}: text layer line is ${share.toFixed(3)} of the page, glyphs are ${truth.toFixed(3)}`);
    }
    await shot("02-pdf-fit-width");
    await browser.$('.reader-bar button[aria-label="Toggle zoom mode"]').click();
    const back = await marksOnLines([`South pier: ${PHRASE} after the storm.`], "fit page again");
    return { fit_page: fitPage, fit_width: fitWidth, back, line_share: { truth, fit_page: fitPageLine, fit_width: fitWidthLine } };
  });

  await step("U1 PDF: clicking the painted rect opens the panel and deletes nothing", async () => {
    const before = JSON.stringify(highlightsOnDisk(PDF_REL));
    await closePanel();
    await browser.$(".pdf-highlight").click();
    await browser.$(".highlights-panel").waitForExist({ timeout: RESPONSIVE_MS });
    const rows = await panelRows();
    check(rows.length === 2, `panel rows ${JSON.stringify(rows)}`);
    check(JSON.stringify(highlightsOnDisk(PDF_REL)) === before, "click changed the sidecar");
    await marksOnLines([`South pier: ${PHRASE} after the storm.`], "still painted after the click");
    return { rows };
  });

  await step("U2 PDF: quote navigates (mouse and keyboard); note saved", async () => {
    await (await panelButton(PHRASE, "jump")).click(); // two rows share the quote: first is page 2
    const rows = await panelRows();
    check(rows.map((r) => r.location).join(",") === "page 2,page 1", `rows ${JSON.stringify(rows)}`);
    const jumps = await browser.$$(".highlights-panel .highlight-jump");
    await jumps[1].click();
    await pdfAt(1);
    // Keyboard: focus the page-2 quote button and press Enter.
    await browser.execute(() => document.querySelectorAll(".highlights-panel .highlight-jump")[0].focus());
    await browser.keys(["Enter"]);
    await pdfAt(2);
    const rowsAgain = await browser.$$(".highlights-panel li");
    await rowsAgain[0].$("button=Add note").click();
    await browser.execute((v) => {
      const el = document.querySelector(".note-editor textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, "South pier, after the storm");
    await browser.$(".note-editor").$("button=Save note").click();
    const noted = await waitFor(
      "note on disk",
      async () => highlightsOnDisk(PDF_REL).find((h) => h.id === saved.pdfSouth.id && h.note === "South pier, after the storm"),
      RESPONSIVE_MS,
    );
    check(noted.updated_at >= noted.created_at, "LWW timestamp not advanced");
    saved.pdfSouth = noted;
    return { note: noted.note };
  });

  await step("P3 PDF: explicit Remove tombstones the page-1 highlight", async () => {
    await pdfGo(1);
    await openPanel();
    const rows = await browser.$$(".highlights-panel li");
    await rows[1].$("button=Remove").click();
    await waitFor("one panel row left", async () => (await panelRows()).length === 1, RESPONSIVE_MS);
    check((await pdfMarks()).length === 0, "removed highlight still painted on page 1");
    const stored = highlightsOnDisk(PDF_REL).find((h) => h.id === saved.pdfEvening.id);
    check(stored?.deleted === true && stored.updated_at >= stored.created_at, `tombstone ${JSON.stringify(stored)}`);
    await closePanel();
    return { tombstone: stored.id };
  });

  await step("E1 EPUB: drag-select a repeated phrase in paragraph 3 -> pill -> painted there", async () => {
    await toLibrary();
    await clickRead(EPUB);
    await waitEpub();
    const target = await epubPhraseRect(2, "quiet weather");
    await drag(target);
    const pill = await pillText();
    check(pill.includes("quiet weather"), `pill ${pill}`);
    await pressHighlight();
    const h = await newHighlight(EPUB_REL, [], "EPUB highlight on disk");
    await epubMarksOn([target.paragraph], "EPUB mark over the selected paragraph only");
    const a = h.anchor;
    check(a.type === "epub-cfi" && /^epubcfi\(.+,.+,.+\)$/.test(a.cfi), `cfi ${a.cfi}`);
    check(a.quote.exact === "quiet weather" && a.quote.prefix.endsWith("field notes and ") && a.quote.suffix.startsWith(", repeated"), `quote ${JSON.stringify(a.quote)}`);
    check(a.position.end - a.position.start === "quiet weather".length, `position ${JSON.stringify(a.position)}`);
    check(a.href === "ch1.xhtml" && a.chapter === "First Light", `section ${a.href} ${a.chapter}`);
    check(isUuid(h.id), `id ${h.id}`);
    saved.epubQuiet = { ...h, paragraph: target.paragraph };
    await shot("03-epub-highlight");
    return { id: h.id, anchor: a, paragraph: target.paragraph };
  });

  await step("U1 EPUB: clicking the painted highlight opens the panel and deletes nothing", async () => {
    const before = JSON.stringify(highlightsOnDisk(EPUB_REL));
    await closePanel();
    await browser.$(".reader g.pb-highlight rect").click();
    await browser.$(".highlights-panel").waitForExist({ timeout: RESPONSIVE_MS });
    const rows = await panelRows();
    check(rows.length === 1 && rows[0].quote === "quiet weather" && rows[0].location.startsWith("First Light"), `rows ${JSON.stringify(rows)}`);
    check(JSON.stringify(highlightsOnDisk(EPUB_REL)) === before, "click changed the sidecar");
    await epubMarksOn([saved.epubQuiet.paragraph], "still painted after the click");
    await closePanel();
    return { rows };
  });

  await step("E1/U2 EPUB: second highlight two pages on; Remove it; quote jumps back to the first", async () => {
    for (let i = 0; i < 2; i++) {
      await browser.$('.reader-bar button[aria-label="Next page"]').click();
      await new Promise((r) => setTimeout(r, 400));
    }
    await waitFor("first highlight off screen", async () => (await epubMarkParagraphs()).length === 0, RESPONSIVE_MS);
    const target = await epubPhraseRect(1, "field notes");
    await drag(target);
    await pillText();
    await pressHighlight();
    const h = await newHighlight(EPUB_REL, [saved.epubQuiet.id], "second EPUB highlight on disk");
    await epubMarksOn([target.paragraph], "second mark over its paragraph");
    await openPanel();
    await (await panelButton("field notes", "Remove")).click();
    await waitFor("second mark gone", async () => (await epubMarkParagraphs()).length === 0, RESPONSIVE_MS);
    const stored = highlightsOnDisk(EPUB_REL).find((x) => x.id === h.id);
    check(stored?.deleted === true, `tombstone ${JSON.stringify(stored)}`);
    saved.epubRemoved = h;
    // Keyboard: Enter on the remaining quote navigates back to it.
    await browser.execute(() => document.querySelector(".highlights-panel .highlight-jump").focus());
    await browser.keys(["Enter"]);
    await epubMarksOn([saved.epubQuiet.paragraph], "jumped back to the first highlight");
    await closePanel();
    return { removed: h.id, removed_paragraph: target.paragraph };
  });

  await step("E2 EPUB: close and reopen the tab repaints only the live highlight", async () => {
    await closeTab(EPUB);
    await clickRead(EPUB);
    await waitEpub();
    await epubMarksOn([saved.epubQuiet.paragraph], "repainted after reopen");
    return { live: live(EPUB_REL).map((h) => h.id) };
  });

  await step("failure: unwritable sidecar -> add/remove report it, nothing is lost", async () => {
    await toLibrary();
    await clickRead(PDF);
    await pdfGo(2);
    const file = sidecarFile(PDF_REL);
    const original = readFileSync(file);
    const aside = `${file}.e2e-held`;
    renameSync(file, aside);
    mkdirSync(file); // a directory where the sidecar belongs: no read, no write, even as root
    await drag(await pdfPhraseRect("Harbor office", PHRASE));
    await pillText();
    await pressHighlight();
    const addNotice = await waitFor("add failure notice", async () => {
      const n = await notices();
      return /Could not save the highlight/.test(n) ? n : null;
    }, RESPONSIVE_MS);
    await marksOnLines([`South pier: ${PHRASE} after the storm.`], "no phantom mark after the failed add");
    await openPanel();
    await (await browser.$$(".highlights-panel li"))[0].$("button=Remove").click();
    const removeNotice = await waitFor("remove failure notice", async () => {
      const n = await notices();
      return /Could not remove the highlight/.test(n) ? n : null;
    }, RESPONSIVE_MS);
    check((await panelRows()).length === 1, "a failed Remove dropped the row");
    await marksOnLines([`South pier: ${PHRASE} after the storm.`], "still painted after the failed Remove");
    await shot("04-unwritable-sidecar");
    rmSync(file, { recursive: true });
    renameSync(aside, file);
    check(readFileSync(file).equals(original), "sidecar bytes changed");
    await closePanel();
    await closeTab(PDF);
    return { add_notice: addNotice, remove_notice: removeNotice };
  });

  await step("X1 export through the Obsidian panel: per-book notes on disk", async () => {
    const userNoteBefore = treeDigest(path.join(vaultDir, "Daily"));
    const result = await syncExport();
    check(result.skipped.length === 0, `skipped ${JSON.stringify(result.skipped)}`);
    const files = exportFiles();
    const pdfNote = "Synthetic Harbormaster - Tidewater Echo Ledger.md";
    const epubNote = "Synthetic Fixture - Zephyr Lantern Field Notes.md";
    check(JSON.stringify(files) === JSON.stringify([pdfNote, epubNote].sort()), `export files ${JSON.stringify(files)}`);
    const pdfText = exportText(pdfNote);
    const epubText = exportText(epubNote);
    for (const [k, v] of [["title", "Tidewater Echo Ledger"], ["author", "Synthetic Harbormaster"], ["source", PDF_REL], ["generated_by", "properbooky"]]) {
      check(pdfText.includes(`\n${k}: ${v}\n`), `PDF note frontmatter lacks ${k}`);
    }
    check(pdfText.includes(`> ${PHRASE}\n> — page 2 ^pb-${saved.pdfSouth.id.slice(0, 8)}\n`), "PDF quote/location/marker");
    check(pdfText.includes("**Note:** South pier, after the storm"), "PDF note text");
    check(!pdfText.includes(saved.pdfEvening.id.slice(0, 8)), "removed PDF highlight exported");
    check(epubText.includes("\ntitle: Zephyr Lantern Field Notes\n") && epubText.includes("\nauthor: Synthetic Fixture\n"), "EPUB identity");
    check(new RegExp(`> quiet weather\\n> — First Light( · \\d+%)? \\^pb-${saved.epubQuiet.id.slice(0, 8)}\\n`).test(epubText), "EPUB quote/location/marker");
    check(!epubText.includes(saved.epubRemoved.id.slice(0, 8)), "removed EPUB highlight exported");
    check(JSON.stringify(treeDigest(path.join(vaultDir, "Daily"))) === JSON.stringify(userNoteBefore), "export touched the user's own vault notes");
    check(readdirSync(vaultDir).sort().join(",") === "Daily,Properbooky", `vault now holds ${readdirSync(vaultDir)}`);
    saved.export = { pdfNote, epubNote, report: result.text };
    return { report: result.text, files };
  });

  await step("X2 export rerun is idempotent and keeps the user's own text", async () => {
    const before = treeDigest(exportDir());
    const again = await syncExport();
    check(/\(0 updated\)/.test(again.text), `rerun said ${again.text}`);
    check(JSON.stringify(treeDigest(exportDir())) === JSON.stringify(before), "rerun changed the notes");
    const notePath = path.join(exportDir(), saved.export.pdfNote);
    const edited = exportText(saved.export.pdfNote)
      .replace("generated_by: properbooky\n", "generated_by: properbooky\ntags: [harbor]\n")
      .concat("\n## My thoughts\nThe South pier matters most.\n");
    writeFileSync(notePath, edited);
    const third = await syncExport();
    const text = exportText(saved.export.pdfNote);
    check(text.includes("## My thoughts\nThe South pier matters most.\n") && text.includes("tags:"), "user text or key lost");
    check(/\(0 updated\)/.test(third.text) || text === edited, "rerun rewrote an unchanged note");
    return { rerun: again.text, after_user_edit: third.text };
  });

  await step("close app (session 1)", closeApp);

  if (FAULT === "lost-tombstone") {
    const file = sidecarFile(EPUB_REL);
    const value = JSON.parse(readFileSync(file, "utf8"));
    value.highlights = value.highlights.map((h) => ({ ...h, deleted: false }));
    writeFileSync(file, JSON.stringify(value, null, 2));
  }

  // ---- Session 2: restart the same binary ------------------------------------
  await step("relaunch same packaged binary", launchApp);

  await step("E2 after restart: EPUB repaints the live highlight; the removed one stays removed", async () => {
    await waitTitles(ALL, 30000);
    await clickRead(EPUB);
    await waitEpub();
    await openPanel();
    const rows = await panelRows();
    check(rows.length === 1 && rows[0].quote === "quiet weather", `removal did not stay removed: panel ${JSON.stringify(rows)}`);
    await (await panelButton("quiet weather", "jump")).click();
    await epubMarksOn([saved.epubQuiet.paragraph], "EPUB mark after restart");
    const stored = highlightsOnDisk(EPUB_REL);
    check(stored.find((h) => h.id === saved.epubRemoved.id)?.deleted === true, "tombstone lost after restart");
    await closePanel();
    await shot("05-restart-epub");
    return { rows };
  });

  await step("P2 after restart: PDF exact line, removed page-1 highlight absent", async () => {
    await toLibrary();
    await clickRead(PDF);
    await pdfGo(2);
    await marksOnLines([`South pier: ${PHRASE} after the storm.`], "PDF page 2 after restart");
    await pdfGo(1);
    check((await pdfMarks()).length === 0, "removed page-1 highlight came back");
    await openPanel();
    const rows = await panelRows();
    check(rows.length === 1 && rows[0].note === "South pier, after the storm", `rows ${JSON.stringify(rows)}`);
    await closePanel();
    return { rows };
  });

  await step("failure: corrupt EPUB sidecar is set aside and its export note is not emptied", async () => {
    await closeTab(PDF);
    await closeTab(EPUB);
    const file = sidecarFile(EPUB_REL);
    const corrupt = Buffer.concat([readFileSync(file).subarray(0, 120), Buffer.from(" <truncated>")]);
    writeFileSync(file, corrupt);
    const noteBefore = exportText(saved.export.epubNote);
    // Export first, while the sidecar is unreadable: skipped, note untouched.
    const result = await syncExport();
    check(result.skipped.some((s) => /unreadable/.test(s)), `skipped ${JSON.stringify(result.skipped)}`);
    check(exportText(saved.export.epubNote) === noteBefore, "unreadable sidecar emptied the export note");
    await clickRead(EPUB);
    await waitEpub();
    const notice = await waitFor("corrupt sidecar notice", async () => {
      const n = await notices();
      return /could not be read/.test(n) ? n : null;
    }, RESPONSIVE_MS);
    const kept = readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.unreadable-`));
    check(kept.length === 1 && readFileSync(path.join(path.dirname(file), kept[0])).equals(corrupt), "corrupt bytes not preserved");
    // Put the good state back for the rebuild phase (as a user restoring it).
    await closeTab(EPUB);
    return { skipped: result.skipped, notice, kept: kept[0] };
  });

  await step("close app (session 2)", closeApp);

  // ---- Session 3: index rebuild + CFI fallback --------------------------------
  let digestBeforeRebuild = null;
  await step("rebuild index from empty app-data; restore EPUB state with a stale CFI", () => {
    const file = sidecarFile(EPUB_REL);
    const kept = readdirSync(path.dirname(file)).find((n) => n.startsWith(`${path.basename(file)}.unreadable-`));
    rmSync(path.join(path.dirname(file), kept));
    // Restore the EPUB highlights, with the live one's CFI made unresolvable:
    // it must still paint at its quote + position (multi-selector fallback).
    const restored = {
      position: null,
      highlights: [
        { ...saved.epubQuiet, paragraph: undefined, anchor: { ...saved.epubQuiet.anchor, cfi: "epubcfi(/6/2!/4/999,/1:0,/1:13)" } },
        { ...saved.epubRemoved, deleted: true, updated_at: saved.epubRemoved.created_at + 1 },
      ].map(({ paragraph, ...h }) => h),
      updated_at: saved.epubQuiet.created_at,
    };
    delete restored.position;
    writeFileSync(file, JSON.stringify(restored, null, 2));
    rmSync(dataDir, { recursive: true });
    mkdirSync(dataDir);
    digestBeforeRebuild = treeDigest(path.join(libraryDir, ".properbooky", "state"));
    return { state_files: digestBeforeRebuild.length };
  });

  await step("relaunch on empty app-data and re-index the same folder", async () => {
    await launchApp();
    const indexed = await indexLibrary();
    check(JSON.stringify(treeDigest(path.join(libraryDir, ".properbooky", "state"))) === JSON.stringify(digestBeforeRebuild), "re-indexing rewrote reading state");
    return indexed;
  });

  await step("S1/E1 after index rebuild: PDF line exact; stale EPUB CFI falls back to its quote", async () => {
    await clickRead(PDF);
    await pdfGo(2);
    await marksOnLines([`South pier: ${PHRASE} after the storm.`], "PDF after index rebuild");
    await toLibrary();
    await clickRead(EPUB);
    await waitEpub();
    await epubMarksOn([saved.epubQuiet.paragraph], "EPUB painted via quote fallback (book opens at its start)");
    await openPanel();
    check((await panelRows()).length === 1, "removed EPUB highlight resurfaced after rebuild");
    await shot("06-after-rebuild-fallback");
    return { epub_paragraph: saved.epubQuiet.paragraph };
  });

  await step("close app (session 3)", closeApp);

  await step("files are the truth: sidecars hold UUID records, tombstones and anchors", () => {
    const pdf = highlightsOnDisk(PDF_REL);
    const epub = highlightsOnDisk(EPUB_REL);
    check(pdf.length === 2 && pdf.filter((h) => h.deleted).length === 1, `PDF records ${JSON.stringify(pdf)}`);
    check(epub.length === 2 && epub.filter((h) => h.deleted).length === 1, `EPUB records ${JSON.stringify(epub)}`);
    check([...pdf, ...epub].every((h) => isUuid(h.id) && h.updated_at >= h.created_at), "ids/timestamps");
    const appData = listTree(dataDir).map((f) => f.path);
    check(!appData.some((p) => p.endsWith(".json")), `JSON state in app-data: ${JSON.stringify(appData)}`);
    report.sidecars = { pdf, epub };
    report.export_notes = Object.fromEntries(exportFiles().map((n) => [n, exportText(n)]));
    return { pdf: pdf.length, epub: epub.length, export_notes: exportFiles() };
  });

  stopWatchdog();
  await finish(0, "pass");
} catch {
  stopWatchdog();
  await finish(1, "fail");
}
