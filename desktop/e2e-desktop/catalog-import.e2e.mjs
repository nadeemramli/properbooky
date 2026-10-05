// PBK-19 catalog import journey, packaged: drives the built ProperBooky
// binary (tauri-driver/WebKitWebDriver, harness.mjs) through the Import
// catalog panel with synthetic Library of Books CSV exports, against temp
// copies of the committed synthetic fixture library and fresh app-data.
// Profiles are asserted on disk (names, bytes, modification times) and in the
// UI (cards, status badges, Status/Rating facets, search) across a refused
// CSV, a preview, a repeated and a changed import, an owner edit, restart,
// other libraries (refusals, isolation, a symlinked Catalog) and quitting the
// app in the middle of a large import. The import CLI and the library MCP
// server read the same results.
//
// Usage (Linux, inside an X server or `xvfb-run -a`):
//   E2E_APP=/path/to/desktop E2E_IMPORT_CLI=/path/to/examples/import_catalog \
//     node e2e-desktop/catalog-import.e2e.mjs
// The library MCP server's dependencies must be installed (cd mcp && npm ci).
// Environment as in harness.mjs; default whole-run watchdog 900000ms.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP,
  ARTIFACTS,
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
  rawInvoke,
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

const CLI = path.resolve(process.env.E2E_IMPORT_CLI ?? path.join(here, "../src-tauri/target/debug/examples/import_catalog"));
const MCP_DIR = path.join(here, "../../mcp");
const FILE_TITLES = ["Zephyr Lantern Field Notes", "basalt ledger handbook", "quillfeather orbit atlas"];

// --- the synthetic sheet --------------------------------------------------------

const HEADER = ["Book Title", "Author", "Date Releases", "Types", "Topic Category", "Recommendation", "Rating", "Status", "Date Input", "Latticework", "Sheet Notes"];
const LATTICE =
  '## Latticework\n\nBets are decisions under uncertainty; "resulting" is a trap.\n---\nkey: looks like YAML\n# not a YAML comment\n  - indented line   \n\nCJK 思考 · emoji 🎲\nlast line';
const quote = (f) => `"${String(f).replaceAll('"', '""')}"`;
const csvText = (rows) => [HEADER, ...rows].map((r) => (Array.isArray(r) ? r.map(quote).join(",") : r)).join("\n") + "\n";
const sheetRow = (title, author, { released = "", type = "", topics = "", rec = "", rating = "", status = "", input = "", lattice = "" } = {}) => [
  title, author, released, type, topics, rec, rating, status, input, lattice, "not imported",
];

const BETS = "Thinking in Bets";
const CULTURE = "The Culture Map";
const DEEP = "Deep Work";
const RANGE = "Range";
const WORK = 'Re: "Work" — A Novel';
const NONE = "...And Then There Were None";
const CPP = "C++ Primer";
const C = "C Primer";
const SHEET = [
  sheetRow(BETS, "Annie Duke", { released: "2018", type: "Book", topics: "Decision Making, Psychology", rec: "Must read", rating: "5", status: "Downloaded", input: "2024-01-02", lattice: LATTICE }),
  sheetRow(CULTURE, "Erin Meyer", { released: "2014", type: "Book", topics: "Business", status: "Need to read now" }),
  sheetRow(DEEP, "Cal Newport", { topics: "Productivity", rating: "4", status: "Reading" }),
  sheetRow(RANGE, "David Epstein"),
  sheetRow(WORK, "García Márquez, Gabriel", { type: "Novel", topics: "Fiction", rating: "3", status: "downloaded", lattice: 'He said "hello", then left.' }),
  sheetRow(NONE, "Agatha Christie", { rating: "5", status: "Need to read now" }),
  sheetRow("  thinking   in BETS ", "ANNIE  duke", { rating: "1" }),
  sheetRow(CPP, "Stanley Lippman"),
  sheetRow(C, "Stanley Lippman"),
  sheetRow("Anonymous Book", "", { status: "Downloaded" }),
  sheetRow("Half Stars", "Rater", { rating: "4.5" }),
  '"Too Short","Only Two"',
  ",,,,,,,,,,",
];
// The CSV line each row starts on (quoted fields may span several lines).
const lineOf = (index) =>
  2 + SHEET.slice(0, index).reduce((n, r) => n + 1 + (Array.isArray(r) ? r.join("") : r).split("\n").length - 1, 0);
const LINE = { culture: lineOf(1), deep: lineOf(2), range: lineOf(3), dupe: lineOf(6), cpp: lineOf(7), anonymous: lineOf(9), half: lineOf(10), short: lineOf(11) };
const IMPORTED = {
  [BETS]: { file: "Annie Duke - Thinking in Bets.md", author: "Annie Duke", status: "available", rating: 5, topics: "Decision Making, Psychology" },
  [CULTURE]: { file: "Erin Meyer - The Culture Map.md", author: "Erin Meyer", status: "queued", rating: null, topics: "Business" },
  [DEEP]: { file: "Cal Newport - Deep Work.md", author: "Cal Newport", status: "wishlist", rating: 4, topics: "Productivity" },
  [RANGE]: { file: "David Epstein - Range.md", author: "David Epstein", status: "wishlist", rating: null, topics: null },
  [WORK]: { file: "García Márquez, Gabriel - Re Work — A Novel.md", author: "García Márquez, Gabriel", status: "available", rating: 3, topics: "Fiction" },
  [NONE]: { file: "Agatha Christie - ...And Then There Were None.md", author: "Agatha Christie", status: "queued", rating: 5, topics: null },
  [CPP]: { file: "Stanley Lippman - C++ Primer.md", author: "Stanley Lippman", status: "wishlist", rating: null, topics: null },
  [C]: { file: "Stanley Lippman - C Primer.md", author: "Stanley Lippman", status: "wishlist", rating: null, topics: null },
};
const IMPORTED_FILES = Object.values(IMPORTED).map((b) => b.file).sort();
const ALL = [...FILE_TITLES, ...Object.keys(IMPORTED)].sort();
const BADGE = { wishlist: "Wishlist", queued: "Queued", available: "Available" };
const BULK = 4000;
const bulkTitle = (i) => `Bulk Book ${String(i).padStart(4, "0")}`;

// --- disk -----------------------------------------------------------------------

let tempRoot = null;
const lib = (name) => path.join(tempRoot, name);

/** Every file under `dir`: relative path -> sha256 and mtime (dot-folders included). */
function digest(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) out[path.relative(dir, full)] = "symlink";
      else if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = `${createHash("sha256").update(readFileSync(full)).digest("hex")}@${statSync(full).mtimeMs}`;
    }
  };
  walk(dir);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Paths whose content or mtime differ between two digests. */
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
const catalogFiles = (root) => (existsSync(path.join(root, "Catalog")) ? readdirSync(path.join(root, "Catalog")).sort() : null);

// --- UI -------------------------------------------------------------------------

const shot = (name) => browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));
const exists = (selector) => browser.execute((s) => Boolean(document.querySelector(s)), selector);
const present = (selector) => waitFor(`${selector} shown`, () => exists(selector), RESPONSIVE_MS);
const absent = (selector) => waitFor(`${selector} gone`, async () => !(await exists(selector)), RESPONSIVE_MS);

// A WebDriver click on a still-disabled button is ignored: wait until enabled.
async function clickLabel(label) {
  let seen = "missing";
  try {
    await waitFor(
      `enabled button "${label}"`,
      async () => {
        seen = await browser.execute((l) => {
          const el = Array.from(document.querySelectorAll("button")).find(
            (b) => b.getAttribute("aria-label") === l || b.textContent.trim() === l,
          );
          if (!el) return "missing";
          if (el.disabled) return "disabled";
          el.click();
          return "clicked";
        }, label);
        return seen === "clicked";
      },
      RESPONSIVE_MS,
    );
  } catch {
    throw new Error(`button "${label}" ${seen}`);
  }
}

// WebKit's native option clicking is unreliable: set the value, fire change.
const select = (selector, value) =>
  browser.execute(
    (s, v) => {
      const el = document.querySelector(s);
      if (![...el.options].some((o) => o.value === v)) throw new Error(`no option ${v} in ${s}`);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value,
  );
const optionTexts = (selector) =>
  browser.execute((s) => Array.from(document.querySelector(s)?.options ?? []).map((o) => o.textContent.trim()), selector);

const cards = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll(".grid .card")).map((c) => ({
      title: c.querySelector("h2").textContent.trim(),
      badges: Array.from(c.querySelectorAll(".card-badges .badge")).map((b) => b.textContent.trim()),
      meta: c.querySelector(".meta")?.textContent.trim() ?? null,
    })),
  );

const PANEL = '.acquire-panel[aria-label="Import catalog"]';

/** Import (or preview) through the real panel; returns what the panel shows. */
async function importThroughPanel(csv, { preview = false } = {}) {
  await clickLabel("Import catalog");
  await present(PANEL);
  const input = `${PANEL} input[aria-label="CSV file"]`;
  await setInput(input, csv);
  await waitFor("CSV path in the field", () => browser.execute((s, v) => document.querySelector(s)?.value === v, input, csv), RESPONSIVE_MS);
  await clickLabel(preview ? "Preview" : "Import");
  const shown = await waitFor(
    "import outcome",
    () =>
      browser.execute((p) => {
        const summary = document.querySelector(`${p} .import-summary`)?.textContent.trim() ?? null;
        const alert = document.querySelector(`${p} [role="alert"]`)?.textContent.trim() ?? null;
        if (!summary && !alert) return null;
        const lists = {};
        for (const ul of document.querySelectorAll(`${p} .import-section ul`))
          lists[ul.getAttribute("aria-label")] = Array.from(ul.querySelectorAll("li")).map((li) => li.textContent.trim());
        return { summary, alert, lists };
      }, PANEL),
    120000,
  );
  return shown;
}

async function closePanel() {
  await clickLabel("Close");
  await absent(PANEL);
}

async function search(term, expected) {
  await setInput('.toolbar input[type="search"]', term);
  return waitTitles(expected);
}

async function switchTo(name, titles) {
  await browser.execute(() => document.querySelector(".library-switcher")?.click());
  await present(".libraries-dialog");
  await clickLabel(`Open ${name}`);
  await waitFor(`library "${name}" open`, () => browser.execute((n) => document.querySelector(".library-switcher")?.childNodes[1]?.textContent.trim() === n, name), 30000);
  return waitTitles(titles, 60000);
}

async function expectRefused(promise, pattern, what) {
  try {
    await promise;
  } catch (e) {
    const message = String(e?.message ?? e);
    check(pattern.test(message), `${what}: unexpected error ${message}`);
    return message;
  }
  throw new Error(`${what}: was accepted`);
}

/** The library MCP server, run over this app-data, answers one tool call. */
async function mcpCall(appData, name, args) {
  const require = createRequire(path.join(MCP_DIR, "package.json"));
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
  const env = { ...process.env, PROPERBOOKY_APP_DATA: appData };
  delete env.PROPERBOOKY_DB;
  delete env.PROPERBOOKY_LIBRARY;
  const client = new Client({ name: "pbk19-journey", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(MCP_DIR, "server.mjs")], env }));
  try {
    const result = await client.callTool({ name, arguments: args });
    check(!result.isError, `${name}: ${JSON.stringify(result)}`);
    return JSON.parse(result.content[0].text);
  } finally {
    await client.close();
  }
}

// --- run ------------------------------------------------------------------------

startWatchdog(900000);

try {
  await step("app binary, import CLI, MCP server and fixtures present", () => {
    check(existsSync(APP), `binary not found: ${APP} (build it first)`);
    check(existsSync(CLI), `import CLI not found: ${CLI} (cargo build --example import_catalog)`);
    check(existsSync(path.join(MCP_DIR, "node_modules")), "library MCP server dependencies missing (cd mcp && npm ci)");
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    report.cli = { path: CLI, sha256: sha256(CLI) };
    report.fixtures = readdirSync(fixturesDir).map((n) => ({ name: n, sha256: sha256(path.join(fixturesDir, n)) }));
    check(report.fixtures.length === 3, `expected 3 fixtures, found ${report.fixtures.length}`);
    return { app_sha256: report.app.sha256, cli_sha256: report.cli.sha256 };
  });

  tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  const dataDir = path.join(tempRoot, "data");
  const appData = path.join(dataDir, "com.nadeemramli.properbooky");
  const csvDir = path.join(tempRoot, "exports");
  const ALPHA = lib("alpha-lib");
  const BETA = lib("beta-lib");
  const GAMMA = lib("gamma-lib");
  const DELTA = lib("delta-lib");
  const csv = {
    sheet: path.join(csvDir, "Library of Books.csv"),
    broken: path.join(csvDir, "not-the-sheet.csv"),
    changed: path.join(csvDir, "Library of Books (later).csv"),
    bulk: path.join(csvDir, "bulk.csv"),
  };

  await step("fresh isolated app-data, four synthetic libraries and CSV exports", () => {
    for (const root of [ALPHA, BETA, GAMMA, DELTA]) cpSync(fixturesDir, root, { recursive: true });
    // gamma's Catalog is a link into alpha's (created once alpha has one).
    for (const d of ["data", "config", "cache", "state", "exports"]) mkdirSync(path.join(tempRoot, d), { recursive: true });
    writeFileSync(csv.sheet, csvText(SHEET));
    writeFileSync(csv.broken, "Name,Email\nSomeone,someone@example.com\n");
    const changed = SHEET.map((r) => [...r]);
    changed[1][7] = "Downloaded"; // Culture Map: queued -> available in the sheet
    changed[2][6] = "2"; // Deep Work rating 4 -> 2
    writeFileSync(csv.changed, csvText(changed.map((r, i) => (typeof SHEET[i] === "string" ? SHEET[i] : r))));
    const bulk = [];
    for (let i = 1; i <= BULK; i++) bulk.push(sheetRow(bulkTitle(i), "Bulk Author", { status: "Downloaded", lattice: `Body ${i}` }));
    writeFileSync(csv.bulk, csvText(bulk));
    report.library_dirs = { ALPHA, BETA, GAMMA, DELTA };
    report.csv_sha256 = Object.fromEntries(Object.entries(csv).map(([k, f]) => [k, sha256(f)]));
    return { root: tempRoot, sheet_rows: SHEET.length, bulk_rows: BULK };
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

  // ---- Session 1: alpha ---------------------------------------------------------
  await step("launch packaged app: tab rail visible", launchApp);
  await step("embedded frontend (no dev server)", async () => {
    const origin = await browser.execute(() => window.location.origin);
    check(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin), `webview loaded a dev server origin: ${origin}`);
    return { origin };
  });
  await step("index alpha through the first-run form", async () => {
    const fresh = await invoke("get_library_state");
    check(fresh.library_path === null, `app-data not fresh: ${fresh.library_path}`);
    await waitFor("first-run form", () => browser.execute(() => Boolean(document.querySelector(".path-form input"))), 30000);
    await setInput(".path-form input", ALPHA);
    await waitFor("enabled Index button", () => browser.execute(() => document.querySelector('.path-form button[type="submit"]')?.disabled === false), RESPONSIVE_MS);
    await browser.$('.path-form button[type="submit"]').click();
    return waitTitles(FILE_TITLES, 30000);
  });

  let alphaBefore = digest(ALPHA);
  await step("F1 a CSV that is not the sheet is refused in the panel; nothing written", async () => {
    const shown = await importThroughPanel(csv.broken);
    check(shown.alert?.includes('no "Book Title" or "Author" column') && shown.alert.includes("nothing was imported"), `refusal shown: ${JSON.stringify(shown)}`);
    await closePanel();
    check(same(digest(ALPHA), alphaBefore) && catalogFiles(ALPHA) === null, "the refused import wrote into alpha");
    await waitTitles(FILE_TITLES);
    return { alert: shown.alert };
  });

  await step("C1 preview reports the import and writes nothing", async () => {
    const shown = await importThroughPanel(csv.sheet, { preview: true });
    check(shown.summary === "Preview: would create 8 profiles · 0 already in the catalog · 1 duplicate rows · 3 not imported · nothing was written", `preview summary: ${shown.summary}`);
    await closePanel();
    check(same(digest(ALPHA), alphaBefore) && catalogFiles(ALPHA) === null, "preview wrote into alpha");
    return { summary: shown.summary };
  });

  await step("C1-C3 import through the panel: one profile per book, rows named, statuses mapped", async () => {
    const shown = await importThroughPanel(csv.sheet);
    check(shown.summary === "Created 8 profiles · 0 already in the catalog · 1 duplicate rows · 3 not imported", `summary: ${shown.summary}`);
    const expectRejected = [
      `Line ${LINE.anonymous}: the Author is blank`,
      `Line ${LINE.half}: the Rating "4.5" is not a whole number`,
      `Line ${LINE.short}: the row has 2 fields where the header has 11 (a stray comma or quote?)`,
    ];
    check(same(shown.lists["Not imported"], expectRejected), `not imported: ${JSON.stringify(shown.lists["Not imported"])}`);
    check(same(shown.lists["Duplicate rows skipped"], [`Line ${LINE.dupe}: same book as line 2`]), `duplicates: ${JSON.stringify(shown.lists["Duplicate rows skipped"])}`);
    check(same(shown.lists["Similar titles to review"], [`Line ${LINE.cpp + 1}: C Primer by Stanley Lippman, like line ${LINE.cpp}`]), `near duplicates: ${JSON.stringify(shown.lists["Similar titles to review"])}`);
    check(same(shown.lists["Status"], ["(empty) → wishlist: 4", "Downloaded → available: 1", "Need to read now → queued: 2", "Reading → wishlist: 1", "downloaded → available: 1"]), `status mapping: ${JSON.stringify(shown.lists["Status"])}`);
    await shot("01-import-report");
    await closePanel();
    await waitTitles(ALL, 30000);
    check(same(catalogFiles(ALPHA), IMPORTED_FILES), `Catalog files: ${JSON.stringify(catalogFiles(ALPHA))}`);
    const bets = readFileSync(path.join(ALPHA, "Catalog", IMPORTED[BETS].file), "utf8");
    check(bets.startsWith("---\ntitle: Thinking in Bets\nauthor: Annie Duke\nstatus: available\nrating: 5\n"), `frontmatter:\n${bets}`);
    check(bets.endsWith(`\n---\n\n${LATTICE}\n`), "Latticework body not kept whole");
    check(readFileSync(path.join(ALPHA, "Catalog", IMPORTED[WORK].file), "utf8").endsWith('\n---\n\nHe said "hello", then left.\n'), "quoted body changed");
    const books = await invoke("list_books", { query: null });
    for (const [title, want] of Object.entries(IMPORTED)) {
      const b = books.find((x) => x.title === title);
      check(b?.kind === "catalog", `${title} not indexed as a catalog profile`);
      check(b.author === want.author && b.status === want.status && b.rating === want.rating && b.category === want.topics, `${title} indexed as ${JSON.stringify({ author: b.author, status: b.status, rating: b.rating, category: b.category })}`);
    }
    check(books.filter((b) => b.kind === "file").length === 3, "fixture files not indexed beside the profiles");
    alphaBefore = digest(ALPHA);
    return { files: catalogFiles(ALPHA).length, rejected: expectRejected.length };
  });

  await step("C5 cards show status badges beside availability and the sheet's rating", async () => {
    const shown = await cards();
    for (const [title, want] of Object.entries(IMPORTED)) {
      const card = shown.find((c) => c.title === title);
      check(card, `no card for ${title}`);
      const availability = want.status === "available" ? "File missing" : "No local file";
      check(same(card.badges, [availability, BADGE[want.status]]), `${title} badges ${JSON.stringify(card.badges)}`);
      check(card.meta.endsWith(want.rating ? `★${want.rating}` : "unrated"), `${title} meta ${card.meta}`);
    }
    for (const title of FILE_TITLES) {
      const card = shown.find((c) => c.title === title);
      check(same(card.badges, ["On the shelf"]), `file card ${title} badges ${JSON.stringify(card.badges)}`);
    }
    await shot("02-status-badges");
    return { cards: shown.length };
  });

  await step("C5 Status and Rating facets filter the grid, with counts", async () => {
    const statusOptions = await optionTexts('select[aria-label="Filter by status"]');
    check(same(statusOptions, ["All statuses", "Wishlist (4)", "Queued (2)", "Available (2)"]), `status options ${JSON.stringify(statusOptions)}`);
    const ratingOptions = await optionTexts('select[aria-label="Filter by rating"]');
    check(same(ratingOptions, ["All ratings", "★5 (2)", "★4 (1)", "★3 (1)", "Unrated (4)"]), `rating options ${JSON.stringify(ratingOptions)}`);
    await select('select[aria-label="Filter by status"]', "queued");
    await waitTitles([CULTURE, NONE].sort());
    await select('select[aria-label="Filter by rating"]', "5");
    await waitTitles([NONE]);
    await shot("03-status-and-rating-filter");
    await select('select[aria-label="Filter by status"]', "");
    await waitTitles([BETS, NONE].sort());
    await select('select[aria-label="Filter by rating"]', "unrated");
    await waitTitles([CULTURE, RANGE, CPP, C].sort());
    await select('select[aria-label="Filter by status"]', "available");
    await waitTitles([]);
    await clickLabel("Clear browse filters");
    await waitTitles(ALL);
    return { status: statusOptions, rating: ratingOptions };
  });

  await step("C5 search by title and by author finds imported profiles", async () => {
    const byTitle = await search("culture map", [CULTURE]);
    const byAuthor = await search("erin meyer", [CULTURE]);
    await search("garcía", [WORK]);
    await search("lippman", [C, CPP].sort());
    await search("ledger", ["basalt ledger handbook"]);
    await search("", ALL);
    return { byTitle, byAuthor };
  });

  await step("C4 importing the same CSV again creates nothing; files byte-identical", async () => {
    const shown = await importThroughPanel(csv.sheet);
    check(shown.summary === "Created 0 profiles · 8 already in the catalog · 1 duplicate rows · 3 not imported", `summary: ${shown.summary}`);
    check(!shown.lists["Kept unchanged, the sheet differs"], "an unchanged sheet was reported as differing");
    await closePanel();
    check(same(digest(ALPHA), alphaBefore), "a repeated import changed alpha");
    return { summary: shown.summary };
  });

  await step("C4 a later sheet with changed rows keeps every profile unchanged and says which differ", async () => {
    const shown = await importThroughPanel(csv.changed);
    check(shown.summary.startsWith("Created 0 profiles · 8 already in the catalog"), `summary: ${shown.summary}`);
    check(same(shown.lists["Kept unchanged, the sheet differs"], [`Line ${LINE.culture}: ${IMPORTED[CULTURE].file} (status)`, `Line ${LINE.deep}: ${IMPORTED[DEEP].file} (rating)`]), `differs: ${JSON.stringify(shown.lists["Kept unchanged, the sheet differs"])}`);
    await closePanel();
    check(same(digest(ALPHA), alphaBefore), "a changed sheet rewrote alpha");
    return { differs: shown.lists["Kept unchanged, the sheet differs"] };
  });

  await step("C4 an owner's edit to a profile survives another import", async () => {
    const file = path.join(ALPHA, "Catalog", IMPORTED[RANGE].file);
    writeFileSync(file, `${readFileSync(file, "utf8")}\nMy own notes after the import.\n`);
    const edited = readFileSync(file);
    alphaBefore = digest(ALPHA);
    const shown = await importThroughPanel(csv.sheet);
    check(same(shown.lists["Kept unchanged, the sheet differs"], [`Line ${LINE.range}: ${IMPORTED[RANGE].file} (latticework)`]), `differs: ${JSON.stringify(shown.lists["Kept unchanged, the sheet differs"])}`);
    await closePanel();
    check(readFileSync(file).equals(edited), "the owner's edit was not kept");
    // The rescan records the edited profile's new content in the app-owned
    // identity registry; no profile or other library file changes.
    const diff = changed(alphaBefore, digest(ALPHA));
    check(diff.every((p) => [".properbooky/identities.json", ".properbooky/identities.previous.json"].includes(p)), `import after the owner's edit changed ${JSON.stringify(diff)}`);
    alphaBefore = digest(ALPHA);
    return { kept: IMPORTED[RANGE].file };
  });

  await step("CLI reads the app's profiles: dry run creates nothing; a refused CSV exits 1", () => {
    const dry = spawnSync(CLI, ["--dry-run", csv.sheet, path.join(ALPHA, "Catalog")], { encoding: "utf8" });
    check(dry.status === 0, `dry run exit ${dry.status}: ${dry.stderr}`);
    check(/DRY RUN rows=13 would_create=0 existing=8 duplicates=1 near_duplicates=0 rejected=3 blank_rows=1 /.test(dry.stdout), `dry run: ${dry.stdout.slice(-400)}`);
    const refused = spawnSync(CLI, [csv.broken, path.join(ALPHA, "Catalog")], { encoding: "utf8" });
    check(refused.status === 1 && refused.stderr.includes("nothing was imported"), `refused exit ${refused.status}: ${refused.stderr}`);
    // The same engine writes the same bytes from the CLI.
    const scratch = path.join(tempRoot, "cli-catalog");
    execFileSync(CLI, [csv.sheet, scratch]);
    for (const name of IMPORTED_FILES) {
      if (name === IMPORTED[RANGE].file) continue; // edited by the owner in alpha
      check(readFileSync(path.join(scratch, name)).equals(readFileSync(path.join(ALPHA, "Catalog", name))), `CLI and app differ for ${name}`);
    }
    check(same(digest(ALPHA), alphaBefore), "the CLI dry run wrote into alpha");
    return { dry_run_tail: dry.stdout.trim().split("\n").at(-1) };
  });

  await step("close app (session 1)", closeApp);

  // ---- Session 2: restart --------------------------------------------------------
  await step("relaunch: alpha's profiles, badges and facets persist", async () => {
    await launchApp();
    await waitTitles(ALL, 60000);
    const shown = await cards();
    check(same(shown.find((c) => c.title === CULTURE)?.badges, ["No local file", "Queued"]), "badge after restart");
    check(same(await optionTexts('select[aria-label="Filter by status"]'), ["All statuses", "Wishlist (4)", "Queued (2)", "Available (2)"]), "status facet after restart");
    const again = await importThroughPanel(csv.sheet);
    check(again.summary.startsWith("Created 0 profiles · 8 already in the catalog"), `after restart: ${again.summary}`);
    await closePanel();
    check(same(digest(ALPHA), alphaBefore), "import after restart changed alpha");
    return { cards: shown.length };
  });

  await step("service: the library MCP server sees the imported statuses and finds them", async () => {
    const stats = await mcpCall(appData, "library_stats", {});
    const byStatus = Object.fromEntries(stats.catalog_by_status.map((r) => [r.status, r.n]));
    check(same(byStatus, { available: 2, queued: 2, wishlist: 4 }), `catalog_by_status ${JSON.stringify(stats.catalog_by_status)}`);
    const found = await mcpCall(appData, "search_library", { query: "Erin Meyer" });
    check(found.some((r) => r.title === CULTURE && r.status === "queued" && r.kind === "catalog"), `search ${JSON.stringify(found)}`);
    return { catalog_by_status: byStatus, root: stats.library_root };
  });

  // ---- Other libraries -------------------------------------------------------------
  let betaId = null;
  let alphaId = null;
  await step("S3 import bound to a library that is not open is refused; beta untouched", async () => {
    alphaId = (await invoke("get_library_state")).library_id;
    const betaBefore = digest(BETA);
    betaId = (await rawInvoke("add_library", { path: BETA })).id;
    await expectRefused(rawInvoke("import_catalog", { libraryId: betaId, csvPath: csv.sheet, dryRun: false }), /not open any more/, "beta-bound import while alpha is open");
    check(same(digest(BETA), betaBefore) && catalogFiles(BETA) === null, "the refused import wrote into beta");
    check(same(digest(ALPHA), alphaBefore), "the refused import wrote into alpha");
    return { beta: betaId };
  });

  await step("S3 beta shows none of alpha's profiles; its own import stays in beta", async () => {
    await switchTo("beta-lib", FILE_TITLES);
    await expectRefused(rawInvoke("import_catalog", { libraryId: alphaId, csvPath: csv.sheet, dryRun: false }), /not open any more/, "alpha-bound import while beta is open");
    const shown = await importThroughPanel(csv.changed);
    check(shown.summary.startsWith("Created 8 profiles · 0 already in the catalog"), `beta summary: ${shown.summary}`);
    await closePanel();
    await waitTitles(ALL, 30000);
    check(same(catalogFiles(BETA), IMPORTED_FILES), `beta Catalog ${JSON.stringify(catalogFiles(BETA))}`);
    const culture = (await invoke("list_books", { query: CULTURE }))[0];
    check(culture.status === "available" && culture.path.startsWith(`${BETA}/`), `beta's Culture Map ${JSON.stringify({ status: culture.status, path: culture.path })}`);
    check(same(digest(ALPHA), alphaBefore), "beta's import wrote into alpha");
    return { beta_files: catalogFiles(BETA).length };
  });

  await step("S2 a Catalog folder that links outside the library is refused; alpha untouched", async () => {
    symlinkSync(path.join(ALPHA, "Catalog"), path.join(GAMMA, "Catalog"));
    await rawInvoke("add_library", { path: GAMMA });
    await switchTo("gamma-lib", FILE_TITLES);
    const shown = await importThroughPanel(csv.bulk);
    check(shown.alert?.includes("is a link to another folder") && shown.alert.includes("nothing was imported"), `gamma: ${JSON.stringify(shown)}`);
    await closePanel();
    check(same(digest(ALPHA), alphaBefore), "an import through a linked Catalog wrote into alpha");
    return { alert: shown.alert };
  });

  // ---- Quitting mid-import -------------------------------------------------------
  let afterQuit = 0;
  await step("S1 quitting the app during a large import leaves only complete profiles", async () => {
    await rawInvoke("add_library", { path: DELTA });
    await switchTo("delta-lib", FILE_TITLES);
    await clickLabel("Import catalog");
    await present(PANEL);
    await setInput(`${PANEL} input[aria-label="CSV file"]`, csv.bulk);
    await clickLabel("Import");
    await waitFor("first bulk profile on disk", () => (catalogFiles(DELTA) ?? []).some((n) => n.endsWith(".md")), 60000);
    await closeApp();
    const files = catalogFiles(DELTA);
    const profiles = files.filter((n) => !n.startsWith("."));
    afterQuit = profiles.length;
    for (const name of profiles) {
      const i = Number(/Bulk Book (\d{4})\.md$/.exec(name)?.[1]);
      check(i >= 1 && i <= BULK, `unexpected file ${name}`);
      const text = readFileSync(path.join(DELTA, "Catalog", name), "utf8");
      check(text === `---\ntitle: ${bulkTitle(i)}\nauthor: Bulk Author\nstatus: available\nsource: library-of-books-sheet/ai-enriching-3.0\nsource_status: Downloaded\n---\n\nBody ${i}\n`, `incomplete or unexpected profile ${name}:\n${text}`);
    }
    report.quit_mid_import = { profiles: afterQuit, leftovers: files.filter((n) => n.startsWith(".")), interrupted: afterQuit < BULK };
    return report.quit_mid_import;
  });

  await step("S1 after relaunch, importing again completes the catalog without duplicates", async () => {
    await launchApp();
    await waitFor("delta reopened", () => browser.execute(() => document.querySelector(".library-switcher")?.childNodes[1]?.textContent.trim() === "delta-lib"), 60000);
    const shown = await importThroughPanel(csv.bulk);
    check(shown.summary === `Created ${BULK - afterQuit} profiles · ${afterQuit} already in the catalog · 0 duplicate rows · 0 not imported`, `resume summary: ${shown.summary}`);
    await closePanel();
    const files = catalogFiles(DELTA);
    check(files.length === BULK && files.every((n) => !n.startsWith(".")), `delta Catalog: ${files.length} files, leftovers ${files.filter((n) => n.startsWith("."))}`);
    const status = await waitFor("bulk statuses indexed", async () => {
      const options = await optionTexts('select[aria-label="Filter by status"]');
      return options.includes(`Available (${BULK})`) ? options : null;
    }, 60000);
    check(same(digest(ALPHA), alphaBefore), "delta's import wrote into alpha");
    return { created: BULK - afterQuit, total: files.length, status };
  });

  await step("close app (session 3)", closeApp);

  stopWatchdog();
  await finish(0, "pass");
} catch {
  stopWatchdog();
  await finish(1, "fail");
}
