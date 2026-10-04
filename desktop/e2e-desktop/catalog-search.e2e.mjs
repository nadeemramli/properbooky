// PBK-19 + PBK-15 integration journey, packaged: drives the built ProperBooky
// binary (tauri-driver/WebKitWebDriver, harness.mjs) through a representative
// ~1700-row synthetic Library of Books export imported with the Import
// catalog panel, then the library search and browse states on that large
// catalog: Rescan, search by title and by author, a search with no match and
// Clear search, Status/Rating facets (and their own "Nothing here" state),
// card badges against the profiles' frontmatter, rapid query replacement,
// a repeated import, two other libraries (one empty), a failed listing and
// its recovery, and a restart. Every profile is read back from disk. A DOM
// observer records every view state, so no-results, empty-library, failure
// and "Loading your library…" are each checked against the query and the
// request they describe.
//
// Usage (Linux, inside an X server or `xvfb-run -a`; not as root unless DAC
// capabilities are dropped, e.g. capsh --drop=cap_dac_override,cap_dac_read_search):
//   E2E_APP=/path/to/desktop node e2e-desktop/catalog-search.e2e.mjs
// Environment as in harness.mjs; default whole-run watchdog 900000ms.

import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  launchApp,
  invoke,
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

const FILE_TITLES = ["Zephyr Lantern Field Notes", "basalt ledger handbook", "quillfeather orbit atlas"];
const NO_MATCH = "zzqx";
const SEARCH = '.toolbar input[type="search"]';

// --- the representative synthetic sheet ---------------------------------------------
// Deterministic: the same rows every run. Shaped like the owner's export (column
// set, status spellings, multi-line Latticework, sparse optional fields, a few
// duplicate and malformed rows) without any of its contents.

const HEADER = ["Book Title", "Author", "Date Releases", "Types", "Topic Category", "Recommendation", "Rating", "Status", "Date Input", "Latticework", "Sheet Notes"];
const ADJ = ["Amber", "Brass", "Cedar", "Copper", "Crimson", "Dusky", "Ember", "Fallow", "Gilded", "Granite", "Hollow", "Indigo", "Ivory", "Juniper", "Kestrel", "Lunar", "Marble", "Mossy", "Northern", "Ochre", "Pale", "Quiet", "Russet", "Saffron", "Silver", "Sable", "Tawny", "Umber", "Velvet", "Verdant", "Wandering", "Willow", "Winter", "Yonder", "Zinc", "Ashen", "Briar", "Coral", "Drifting", "Faded", "Golden", "Harbor", "Iron", "Jade", "Linen"];
const NOUN = ["Almanac", "Bridge", "Chronicle", "Compass", "Counsel", "Dialogue", "Echo", "Engine", "Garden", "Grammar", "Harvest", "Inquiry", "Journal", "Kingdom", "Lexicon", "Meridian", "Mosaic", "Narrative", "Observatory", "Parable", "Primer", "Quarry", "Reckoning", "Sonata", "Testament", "Theorem", "Treatise", "Uprising", "Voyage", "Wager", "Workshop", "Archive", "Bestiary", "Cipher", "Doctrine", "Expedition", "Fable", "Gazette", "Horizon", "Inventory"];
const FIRST = ["Ada", "Bram", "Cyrus", "Dalia", "Elio", "Farah", "Gideon", "Hana", "Ilse", "Joaquín", "Kenji", "Leona", "Milo", "Nadia", "Oren", "Priya", "Quentin", "Rhea", "Soren", "Tamsin", "Ulla", "Viktor", "Wren", "Xiomara", "Yusuf", "Zelda", "Anouk", "Bastian", "Céline", "Dmitri"];
const LAST = ["Abernathy", "Bellweather", "Castellano", "Drummond", "Eberhardt", "Fairweather", "Gallagher", "Holloway", "Ishikawa", "Jovanovic", "Kowalczyk", "Lindqvist", "Montgomery", "Nakashima", "Oyelaran", "Pemberton", "Quintero", "Rasmussen", "Szymanski", "Thornbury", "Underhill", "Valdivia", "Whitcombe", "Xanthos", "Yamamoto", "Zielinski", "Achterberg", "Brennan", "Cavendish", "Delacroix"];
const TOPICS = ["Philosophy", "History", "Economics", "Psychology", "Biology", "Mathematics", "Fiction", "Poetry", "Engineering", "Design", "Music", "Cartography"];
const STATUS_SPELLINGS = ["Downloaded", "Downloaded", "Downloaded", "Downloaded", "Downloaded", "Downloaded", "downloaded", "Need to read now", "Need to read now", "need to read  NOW", "Reading", "Not downloaded", "Need to read", "Done", "", "", "", "", "", ""];
const RATINGS = ["", "5", "4", "3", "", "2", "1", "4", "5"];
const UNIQUE = 1690;
const DUPLICATES = 24;
const pad = (n) => String(n).padStart(2, "0");
/** The importer's mapping (PBK-19 C3), restated for the expectations. */
const mapStatus = (s) => ({ downloaded: "available", "need to read now": "queued" })[s.trim().split(/\s+/).join(" ").toLowerCase()] ?? "wishlist";

function bookRow(i) {
  const a = i % 45;
  const adj = ADJ[a];
  const noun = NOUN[(Math.floor(i / 45) + a) % 40];
  const base = `${i % 97 === 0 ? "Élan " : ""}${adj} ${noun}`;
  const title = [`The ${base}`, base, `${base}: Notes on Practice`, `${base}, Volume ${1 + (i % 4)}`, `On the ${base}`, `${base} (Revised Edition)`][i % 6];
  const k = (i * 13) % 330;
  const author = FIRST[k % 30] + " " + LAST[Math.floor(k / 30) % 30];
  const status = STATUS_SPELLINGS[i % 20];
  let rating = RATINGS[i % 9];
  if (mapStatus(status) === "queued" && rating === "1") rating = "2"; // no queued book is rated 1 (facet-zero case)
  const topics = i % 31 === 0 ? "History,, Design ," : Array.from({ length: i % 4 }, (_, j) => TOPICS[(i + j * 5) % 12]).join(", ");
  const lattice =
    i % 4 === 0
      ? `## Latticework\n\n${adj} ideas connect to the ${noun.toLowerCase()}.\n---\nkey: ${i}\n# not a heading in YAML\n  - indented line   \n\nCJK 思考 · row ${i}`
      : i % 4 === 1
        ? `He said "hello" (${i}), then left.`
        : "";
  return {
    title,
    author,
    released: i % 3 === 2 ? "" : String(1850 + ((i * 37) % 175)),
    type: ["Book", "Novel", "Essay", ""][i % 4],
    topics,
    rec: ["Must read", "Maybe", "", "Skim", ""][i % 5],
    rating,
    status,
    input: i % 11 === 0 ? "" : `2024-${pad(1 + (i % 12))}-${pad(1 + (i % 28))}`,
    lattice,
  };
}

const quote = (f) => `"${String(f).replaceAll('"', '""')}"`;
const csvLine = (r) => [r.title, r.author, r.released, r.type, r.topics, r.rec, r.rating, r.status, r.input, r.lattice, "not imported"].map(quote).join(",");

/** The sheet rows (in order) and what the importer must make of them. */
function representativeSheet() {
  const unique = Array.from({ length: UNIQUE }, (_, i) => bookRow(i));
  const rows = unique.map((r) => ({ ...r, kind: "book" }));
  // Same book again under case/space variants (identity: trimmed, collapsed,
  // lowercased): collapses to the first row, whose fields win.
  for (let d = 0; d < DUPLICATES; d++) {
    const s = d * 67 + 5;
    const first = unique[s];
    const variant = [first.title.toUpperCase(), `  ${first.title.split(" ").join("   ")} `, first.title.toLowerCase()][d % 3];
    const at = rows.findIndex((r) => r.kind === "book" && r.title === first.title) + 30 + d;
    rows.splice(at, 0, { ...first, title: variant, author: first.author.toLowerCase(), rating: "1", lattice: "a later, different note", kind: "duplicate", of: s });
  }
  // Two rows the importer names and skips (PBK-19 D2/D3).
  rows.splice(400, 0, { ...bookRow(5000), author: "", kind: "rejected", reason: "the Author is blank" });
  rows.splice(1200, 0, { ...bookRow(5001), rating: "4.5", kind: "rejected", reason: 'the Rating "4.5" is not a whole number' });
  let line = 2;
  for (const r of rows) {
    r.line = line;
    line += csvLine(r).split("\n").length;
  }
  return { rows, unique };
}

// --- disk -----------------------------------------------------------------------------

let tempRoot = null;

/** Every file under `dir`: relative path -> sha256@mtime (dot-folders included). */
function digest(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = `${createHash("sha256").update(readFileSync(full)).digest("hex")}@${statSync(full).mtimeMs}`;
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);

/** YAML scalar as serde_yaml writes the profiles' plain strings and numbers. */
function scalar(v) {
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  if (v.startsWith('"') && v.endsWith('"')) return JSON.parse(v);
  return v;
}
/** Frontmatter (flat keys, block lists) and body of one profile; strict about the shape. */
function readProfile(file) {
  const text = readFileSync(file, "utf8");
  check(text.startsWith("---\n"), `${file}: no opening ---`);
  const end = text.indexOf("\n---\n", 3);
  check(end > 0, `${file}: no closing ---`);
  const fields = {};
  let list = null;
  for (const line of text.slice(4, end).split("\n")) {
    if (line.startsWith("- ")) {
      check(list, `${file}: list item outside a list: ${line}`);
      fields[list].push(scalar(line.slice(2)));
      continue;
    }
    const m = /^([a-z_]+):(?: (.+))?$/.exec(line);
    check(m, `${file}: unexpected frontmatter line ${JSON.stringify(line)}`);
    check(!(m[1] in fields), `${file}: key ${m[1]} twice`);
    if (m[2] === undefined) fields[(list = m[1])] = [];
    else {
      fields[m[1]] = scalar(m[2]);
      list = null;
    }
  }
  return { fields, body: text.slice(end + 5) };
}

/** What the profile of a sheet row must hold (PBK-19 C2). */
function expectedProfile(r) {
  const want = { title: r.title.trim(), author: r.author.trim(), status: mapStatus(r.status), source: "library-of-books-sheet/ai-enriching-3.0" };
  if (r.rating) want.rating = r.rating;
  if (r.rec) want.recommendation = r.rec;
  if (r.type) want.type = r.type;
  const topics = r.topics.split(",").map((t) => t.trim()).filter(Boolean);
  if (topics.length) want.topics = topics;
  if (r.released) want.published = r.released;
  if (r.input) want.added = r.input;
  if (r.status.trim()) want.source_status = r.status.trim();
  return { fields: want, body: r.lattice.trim() ? `\n${r.lattice.trim()}\n` : "" };
}

// --- UI -------------------------------------------------------------------------------

const shot = (name) => browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));
const exists = (selector) => browser.execute((s) => Boolean(document.querySelector(s)), selector);
const PANEL = '.acquire-panel[aria-label="Import catalog"]';
const BADGE = { wishlist: "Wishlist", queued: "Queued", available: "Available" };

async function clickLabel(label) {
  let seen = "missing";
  try {
    await waitFor(
      `enabled button "${label}"`,
      async () => {
        seen = await browser.execute((l) => {
          const el = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === l || b.textContent.trim() === l);
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
const optionTexts = (selector) => browser.execute((s) => Array.from(document.querySelector(s)?.options ?? []).map((o) => o.textContent.trim()), selector);
const STATUS_SELECT = 'select[aria-label="Filter by status"]';
const RATING_SELECT = 'select[aria-label="Filter by rating"]';

/** What the library view shows right now (key `failure`, not `error`: webdriverio reads { error } as a WebDriver error). */
const view = () =>
  browser.execute((sel) => {
    const loadingNow = Boolean(Array.from(document.querySelectorAll('[role="status"]')).find((e) => e.textContent.includes("Loading your library")));
    return {
      query: document.querySelector(sel)?.value ?? null,
      cardCount: document.querySelectorAll(".grid .card").length,
      count: document.querySelector(".chip-count")?.textContent.trim() ?? null,
      noMatch: document.querySelector(".search-empty p")?.textContent.trim() ?? null,
      failure: document.querySelector(".search-error")?.textContent.trim() ?? null,
      emptyLibrary: document.querySelector(".library-empty")?.textContent.trim() ?? null,
      filteredEmpty: document.querySelector(".grid .empty:not(.search-empty)")?.textContent.trim() ?? null,
      loading: loadingNow,
      library: document.querySelector(".library-switcher")?.childNodes[1]?.textContent.trim() ?? null,
    };
  }, SEARCH);

async function settled(what, want, timeout = 30000) {
  let last = null;
  try {
    return await waitFor(
      what,
      async () => {
        last = await view();
        return want(last) ? last : null;
      },
      timeout,
    );
  } catch {
    throw new Error(`${what}: view is ${JSON.stringify(last)}`);
  }
}
const calm = (v) => !v.loading && !v.failure;
const noMatchFor = (q) => (v) => v.query === q && v.cardCount === 0 && v.count === "0 items" && v.noMatch === `No books match “${q}”.` && !v.emptyLibrary && !v.filteredEmpty && calm(v);
const showing = (q, n) => (v) => v.query === q && v.cardCount === n && v.count === `${n} items` && !v.noMatch && !v.emptyLibrary && !v.filteredEmpty && calm(v);

/** Record every state change of the view and the import panel (in the page). */
const observe = () =>
  browser.execute((sel) => {
    window.__pbkStates = [];
    const record = () => {
      window.__pbkStates.push({
        t: Math.round(performance.now()),
        query: document.querySelector(sel)?.value ?? null,
        noMatch: document.querySelector(".search-empty p")?.textContent.trim() ?? null,
        failure: document.querySelector(".search-error")?.textContent.trim() ?? null,
        emptyLibrary: Boolean(document.querySelector(".library-empty")),
        filteredEmpty: document.querySelector(".grid .empty:not(.search-empty)")?.textContent.trim() ?? null,
        loading: Boolean(Array.from(document.querySelectorAll('[role="status"]')).find((e) => e.textContent.includes("Loading your library"))),
        cards: document.querySelectorAll(".grid .card").length,
        importBusy: document.querySelector(".import-run")?.textContent.trim() === "Working…",
        importSummary: Boolean(document.querySelector(".import-summary")),
      });
    };
    window.__pbkObserver?.disconnect();
    window.__pbkObserver = new MutationObserver(record);
    window.__pbkObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    record();
  }, SEARCH);
const recorded = () => browser.execute(() => window.__pbkStates ?? []);
const allStates = [];
const collect = async () => {
  const states = await recorded();
  allStates.push(...states);
  return states;
};

/** No state shows a message for a query or request it does not describe. */
function truthful(states, what) {
  const bad = states.filter(
    (s) =>
      (s.noMatch && (s.noMatch !== `No books match “${s.query}”.` || s.loading || s.cards > 0 || s.failure || s.emptyLibrary || s.filteredEmpty)) ||
      (s.loading && (s.noMatch || s.failure || s.emptyLibrary || s.filteredEmpty)) ||
      (s.failure && (s.cards > 0 || s.noMatch)) ||
      (s.importBusy && s.importSummary),
  );
  check(bad.length === 0, `${what}: ${bad.length} untruthful states, e.g. ${JSON.stringify(bad.slice(0, 4))}`);
}

const cards = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll(".grid .card")).map((c) => ({
      title: c.querySelector("h2").textContent.trim(),
      badges: Array.from(c.querySelectorAll(".card-badges .badge")).map((b) => b.textContent.trim()),
    })),
  );

async function importThroughPanel(csv) {
  await clickLabel("Import catalog");
  await waitFor("Import catalog panel", () => exists(PANEL), RESPONSIVE_MS);
  const input = `${PANEL} input[aria-label="CSV file"]`;
  await setInput(input, csv);
  await waitFor("CSV path in the field", () => browser.execute((s, v) => document.querySelector(s)?.value === v, input, csv), RESPONSIVE_MS);
  await clickLabel("Import");
  return waitFor(
    "import outcome",
    () =>
      browser.execute((p) => {
        const summary = document.querySelector(`${p} .import-summary`)?.textContent.trim() ?? null;
        const alert = document.querySelector(`${p} [role="alert"]`)?.textContent.trim() ?? null;
        if (!summary && !alert) return null;
        const lists = {};
        for (const ul of document.querySelectorAll(`${p} .import-section ul`)) lists[ul.getAttribute("aria-label")] = Array.from(ul.querySelectorAll("li")).map((li) => li.textContent.trim());
        return { summary, alert, lists, busy: document.querySelector(`${p} .import-run`)?.textContent.trim() };
      }, PANEL),
    180000,
  );
}
async function closePanel() {
  await clickLabel("Close");
  await waitFor("panel closed", async () => !(await exists(PANEL)), RESPONSIVE_MS);
}

async function switchTo(name) {
  await browser.execute(() => document.querySelector(".library-switcher")?.click());
  await waitFor("libraries dialog", () => exists(".libraries-dialog"), RESPONSIVE_MS);
  await clickLabel(`Open ${name}`);
  await waitFor(`library "${name}" open`, async () => (await view()).library === name, 30000);
}

function permissionsEnforced() {
  const probe = path.join(tempRoot, "perm-probe");
  mkdirSync(probe, { recursive: true });
  chmodSync(probe, 0o000);
  let enforced = false;
  try {
    readdirSync(probe);
  } catch {
    enforced = true;
  }
  chmodSync(probe, 0o755);
  rmSync(probe, { recursive: true });
  return enforced;
}

// --- run ------------------------------------------------------------------------------

startWatchdog(900000);

try {
  await step("app binary and fixtures present", () => {
    check(existsSync(APP), `binary not found: ${APP} (build it first)`);
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    report.fixtures = readdirSync(fixturesDir).map((n) => ({ name: n, sha256: sha256(path.join(fixturesDir, n)) }));
    check(report.fixtures.length === 3, `expected 3 fixtures, found ${report.fixtures.length}`);
    return { app_sha256: report.app.sha256 };
  });

  tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  const dataDir = path.join(tempRoot, "data");
  const ALPHA = path.join(tempRoot, "alpha-lib");
  const BETA = path.join(tempRoot, "beta-lib");
  const EMPTY = path.join(tempRoot, "empty-lib");
  const CATALOG = path.join(ALPHA, "Catalog");
  const csv = path.join(tempRoot, "exports", "Library of Books.csv");
  const { rows, unique } = representativeSheet();
  const books = rows.filter((r) => r.kind === "book");
  const duplicates = rows.filter((r) => r.kind === "duplicate");
  const rejected = rows.filter((r) => r.kind === "rejected");
  const TOTAL = UNIQUE + FILE_TITLES.length;
  const ALL_TITLES = [...FILE_TITLES, ...unique.map((r) => r.title)].sort();

  /** The catalog books a search finds: every term in title, author or topics (the files never match these terms). */
  const terms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
  // The backend also searches file names and paths: a term must not occur in
  // the (random) temp path or the fixture files for the expectation to hold.
  const pathSafe = (q) => terms(q).every((t) => !tempRoot.toLowerCase().includes(t) && !FILE_TITLES.join(" ").toLowerCase().includes(t));
  const matches = (q) => {
    check(pathSafe(q), `term of "${q}" also in a path or fixture`);
    return unique.filter((r) => terms(q).every((t) => `${r.title} ${r.author} ${r.topics}`.toLowerCase().includes(t)));
  };
  /** Search text for a row's title: its words of 4+ letters (no digits or punctuation). */
  const titleQuery = (r) => r.title.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4).join(" ");
  /** The first row from `from` on whose query (title or author) is path-safe. */
  const pick = (from, make) => {
    for (let k = 0; k < UNIQUE; k++) {
      const r = unique[(from + k) % UNIQUE];
      if (make(r) && pathSafe(make(r))) return { r, q: make(r) };
    }
    throw new Error("no path-safe query");
  };
  const statusCount = (s) => unique.filter((r) => mapStatus(r.status) === s).length;
  const ratingKey = (r) => r.rating || "unrated";

  await step("fresh isolated app-data; alpha, beta, an empty library and the ~1700-row sheet", () => {
    check(permissionsEnforced(), "folder permissions are not enforced for this process (root with DAC override); run as a non-root user or under capsh --drop=cap_dac_override,cap_dac_read_search");
    cpSync(fixturesDir, ALPHA, { recursive: true });
    cpSync(fixturesDir, BETA, { recursive: true });
    mkdirSync(EMPTY);
    for (const d of ["data", "config", "cache", "state", "exports"]) mkdirSync(path.join(tempRoot, d));
    writeFileSync(csv, [HEADER.map(quote).join(","), ...rows.map(csvLine)].join("\n") + "\n");
    const identities = new Set(unique.map((r) => `${r.title.toLowerCase()}\u0000${r.author.toLowerCase()}`));
    check(identities.size === UNIQUE, "generator produced a repeated identity");
    report.sheet = {
      sha256: sha256(csv),
      bytes: statSync(csv).size,
      rows: rows.length,
      unique: UNIQUE,
      duplicates: duplicates.length,
      rejected: rejected.length,
      statuses: Object.fromEntries(["available", "queued", "wishlist"].map((s) => [s, statusCount(s)])),
      with_latticework: unique.filter((r) => r.lattice).length,
    };
    report.library_dirs = { ALPHA, BETA, EMPTY };
    return report.sheet;
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
  await step("launch packaged app: tab rail visible", launchApp);
  await step("embedded frontend (no dev server)", async () => {
    const origin = await browser.execute(() => window.location.origin);
    check(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin), `webview loaded a dev server origin: ${origin}`);
    return { origin };
  });
  await step("index alpha through the first-run form", async () => {
    await waitFor("first-run form", () => browser.execute(() => Boolean(document.querySelector(".path-form input"))), 30000);
    await setInput(".path-form input", ALPHA);
    await waitFor("enabled Index button", () => browser.execute(() => document.querySelector('.path-form button[type="submit"]')?.disabled === false), RESPONSIVE_MS);
    await browser.$('.path-form button[type="submit"]').click();
    return waitTitles(FILE_TITLES, 30000);
  });

  await step("B1 baseline: a search with no match in a library with books says so (no blank grid)", async () => {
    await observe();
    await setInput(SEARCH, NO_MATCH);
    const v = await settled(`no-match message for "${NO_MATCH}"`, noMatchFor(NO_MATCH));
    await clickLabel("Clear search");
    await settled("cleared", showing("", FILE_TITLES.length));
    return v;
  });

  await step("I1-I3 import the representative sheet through the panel: one profile per book, rows named, statuses mapped", async () => {
    const shown = await importThroughPanel(csv);
    check(shown.summary === `Created ${UNIQUE} profiles · 0 already in the catalog · ${DUPLICATES} duplicate rows · ${rejected.length} not imported`, `summary: ${shown.summary}`);
    check(same(shown.lists["Not imported"], rejected.map((r) => `Line ${r.line}: ${r.reason}`)), `not imported: ${JSON.stringify(shown.lists["Not imported"])}`);
    const lineOf = (s) => books.find((r) => r.title === unique[s].title).line;
    check(same(shown.lists["Duplicate rows skipped"], duplicates.map((r) => `Line ${r.line}: same book as line ${lineOf(r.of)}`)), `duplicates: ${JSON.stringify(shown.lists["Duplicate rows skipped"]?.slice(0, 5))}`);
    check(!shown.lists["Similar titles to review"], `unexpected near duplicates ${JSON.stringify(shown.lists["Similar titles to review"]?.slice(0, 5))}`);
    const statusRows = new Map();
    for (const r of rows.filter((x) => x.kind !== "rejected")) {
      const key = r.status.trim();
      statusRows.set(key, (statusRows.get(key) ?? 0) + 1);
    }
    const wantStatus = [...statusRows].map(([s, n]) => `${s || "(empty)"} → ${mapStatus(s)}: ${n}`).sort();
    check(same([...shown.lists.Status].sort(), wantStatus), `status table ${JSON.stringify(shown.lists.Status)} want ${JSON.stringify(wantStatus)}`);
    check(shown.busy === "Import", `panel still says ${shown.busy} after the outcome`);
    await shot("01-import-report");
    await closePanel();
    await settled(`all ${TOTAL} items after the import`, showing("", TOTAL), 60000);
    const states = await collect();
    check(states.some((s) => s.importBusy), "the panel never said Working… while the import ran");
    truthful(states, "import");
    return { summary: shown.summary, status: shown.lists.Status, busy_states: states.filter((s) => s.importBusy).length };
  });

  let catalogBytes = null;
  await step("I1/I2 every profile on disk: one per unique book, frontmatter and Latticework as in its first row", () => {
    const files = readdirSync(CATALOG);
    check(files.length === UNIQUE && files.every((n) => n.endsWith(".md") && !n.startsWith(".")), `Catalog holds ${files.length} entries`);
    const byIdentity = new Map();
    for (const name of files) {
      const p = readProfile(path.join(CATALOG, name));
      const id = `${p.fields.title.toLowerCase()}\u0000${p.fields.author.toLowerCase()}`;
      check(!byIdentity.has(id), `two profiles for ${id}`);
      byIdentity.set(id, { name, ...p });
    }
    let withBody = 0;
    for (const r of unique) {
      const p = byIdentity.get(`${r.title.toLowerCase()}\u0000${r.author.toLowerCase()}`);
      check(p, `no profile for ${r.title} by ${r.author}`);
      const want = expectedProfile(r);
      check(same(Object.keys(p.fields).sort(), Object.keys(want.fields).sort()), `${p.name} keys ${JSON.stringify(Object.keys(p.fields))} want ${JSON.stringify(Object.keys(want.fields))}`);
      for (const [k, v] of Object.entries(want.fields)) check(same(p.fields[k], v), `${p.name} ${k}: ${JSON.stringify(p.fields[k])} want ${JSON.stringify(v)}`);
      check(p.body === want.body, `${p.name} body ${JSON.stringify(p.body.slice(0, 80))} want ${JSON.stringify(want.body.slice(0, 80))}`);
      if (want.body) withBody++;
    }
    catalogBytes = digest(CATALOG);
    return { profiles: files.length, with_latticework: withBody };
  });

  let alphaBytes = null;
  await step("I5 Rescan indexes the catalog beside the files; profiles untouched", async () => {
    await clickLabel("Rescan");
    const status = await waitFor("rescan status", () => browser.execute(() => Array.from(document.querySelectorAll("p.status")).map((p) => p.textContent.trim()).find((t) => t.startsWith("Indexed")) ?? null), 120000);
    await settled(`all ${TOTAL} items after Rescan`, showing("", TOTAL), 60000);
    check(same(digest(CATALOG), catalogBytes), "Rescan changed a profile");
    const listed = await invoke("list_books", { query: null });
    check(listed.filter((b) => b.kind === "file").length === FILE_TITLES.length, "fixture files not indexed beside the profiles");
    const byTitle = new Map(listed.filter((b) => b.kind === "catalog").map((b) => [b.title, b]));
    check(byTitle.size === UNIQUE, `${byTitle.size} catalog entries indexed`);
    for (const r of unique) {
      const b = byTitle.get(r.title);
      const topics = expectedProfile(r).fields.topics?.join(", ") ?? null;
      check(b && b.author === r.author && b.status === mapStatus(r.status) && b.rating === (r.rating ? Number(r.rating) : null) && (b.category ?? null) === topics, `${r.title} indexed as ${JSON.stringify(b && { author: b.author, status: b.status, rating: b.rating, category: b.category })}`);
    }
    alphaBytes = digest(ALPHA);
    return { status };
  });

  await step("I5 search by title and by author finds the catalog; badges match each profile's frontmatter", async () => {
    const statusOnDisk = new Map(readdirSync(CATALOG).map((n) => {
      const p = readProfile(path.join(CATALOG, n));
      return [p.fields.title, p.fields.status];
    }));
    const probe = async (q) => {
      const want = matches(q);
      check(want.length > 0, `no expected match for ${q}`);
      await setInput(SEARCH, q);
      await settled(`search "${q}"`, showing(q, want.length));
      await waitTitles(want.map((r) => r.title).sort());
      const shown = await cards();
      for (const c of shown) check(same(c.badges, [statusOnDisk.get(c.title) === "available" ? "File missing" : "No local file", BADGE[statusOnDisk.get(c.title)]]), `${c.title} badges ${JSON.stringify(c.badges)} vs frontmatter ${statusOnDisk.get(c.title)}`);
      return { query: q, cards: shown.length, badges: [...new Set(shown.map((c) => c.badges.join("+")))] };
    };
    const byTitle = await probe(pick(777, titleQuery).q);
    const byAuthor = await probe(pick(777, (r) => r.author).q);
    check(byAuthor.cards >= 3, `author search found ${byAuthor.cards}`);
    const unicode = await probe("élan");
    await shot("02-author-search");
    return { byTitle, byAuthor, unicode };
  });

  await step("I6 a search with no match in the large catalog: its message and Clear search", async () => {
    await observe();
    await setInput(SEARCH, NO_MATCH);
    const v = await settled(`no-match for "${NO_MATCH}"`, noMatchFor(NO_MATCH));
    await shot("03-no-match");
    await clickLabel("Clear search");
    await settled("whole catalog back", showing("", TOTAL), 60000);
    await waitTitles(ALL_TITLES, 30000);
    truthful(await collect(), "no match and Clear search");
    return { noMatch: v.noMatch, count: v.count };
  });

  await step("I7 Status/Rating facets with counts; a facet that hides everything says Nothing here, not no-match", async () => {
    const wantStatus = ["All statuses", ...["wishlist", "queued", "available"].filter((s) => statusCount(s)).map((s) => `${BADGE[s]} (${statusCount(s)})`)];
    const statusOptions = await optionTexts(STATUS_SELECT);
    check(same(statusOptions, wantStatus), `status options ${JSON.stringify(statusOptions)} want ${JSON.stringify(wantStatus)}`);
    const ratings = new Map();
    for (const r of unique) ratings.set(ratingKey(r), (ratings.get(ratingKey(r)) ?? 0) + 1);
    const wantRating = ["All ratings", ...["5", "4", "3", "2", "1"].filter((k) => ratings.get(k)).map((k) => `★${k} (${ratings.get(k)})`), `Unrated (${ratings.get("unrated")})`];
    const ratingOptions = await optionTexts(RATING_SELECT);
    check(same(ratingOptions, wantRating), `rating options ${JSON.stringify(ratingOptions)} want ${JSON.stringify(wantRating)}`);

    await observe();
    await select(STATUS_SELECT, "queued");
    await settled("queued only", showing("", statusCount("queued")));
    const queued5 = unique.filter((r) => mapStatus(r.status) === "queued" && r.rating === "5").length;
    await select(RATING_SELECT, "5");
    await settled("queued and ★5", showing("", queued5));
    check(unique.filter((r) => mapStatus(r.status) === "queued" && r.rating === "1").length === 0 && ratings.get("1") > 0, "sheet lost its facet-zero case");
    await select(RATING_SELECT, "1");
    const zero = await settled("queued and ★1 hides everything", (v) => v.query === "" && v.cardCount === 0 && v.count === "0 items" && v.filteredEmpty === "Nothing here." && !v.noMatch && !v.emptyLibrary && calm(v));
    await shot("04-facet-zero");
    // A search that finds books which the facet hides: still the facet's message.
    const author = unique.find((r) => pathSafe(r.author) && matches(r.author).every((m) => mapStatus(m.status) !== "queued")).author;
    await select(RATING_SELECT, "");
    await setInput(SEARCH, author);
    const hidden = await settled(`"${author}" hidden by the queued facet`, (v) => v.query === author && v.cardCount === 0 && v.filteredEmpty === `Nothing here for “${author}”.` && !v.noMatch && calm(v));
    // A search with no match keeps its own message under a facet.
    await setInput(SEARCH, NO_MATCH);
    await settled("no match under a facet", noMatchFor(NO_MATCH));
    await clickLabel("Clear search");
    await settled("queued again after Clear search", showing("", statusCount("queued")));
    await clickLabel("Clear browse filters");
    await settled("all items without facets", showing("", TOTAL), 60000);
    truthful(await collect(), "facets");
    return { status: statusOptions, rating: ratingOptions, facetZero: zero.filteredEmpty, hidden: hidden.filteredEmpty };
  });

  await step("I10/I12 rapid query replacement: the view answers the last query; no stale or early message; loading truthful", async () => {
    const author = pick(1234, (r) => r.author).q;
    const authorHits = matches(author).length;
    const burst = (plan) =>
      browser.execute(
        (sel, p) => {
          const el = document.querySelector(sel);
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          for (const [at, value] of p)
            setTimeout(() => {
              setter.call(el, value);
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }, at);
        },
        SEARCH,
        plan,
      );
    await observe();
    // Within the debounce (20ms apart) and across it (170ms apart: overlapping requests).
    await burst([[0, "amb"], [20, "ambe"], [40, "amber"], [60, ""], [230, NO_MATCH], [400, ""], [570, titleQuery(unique[42])], [740, author.toLowerCase()]]);
    await settled("burst A settled on the author", showing(author.toLowerCase(), authorHits));
    await new Promise((r) => setTimeout(r, 1500));
    check(showing(author.toLowerCase(), authorHits)(await view()), `burst A changed after settling: ${JSON.stringify(await view())}`);
    await burst([[0, ""], [170, NO_MATCH.slice(0, 2)], [190, NO_MATCH], [360, author], [380, ""], [550, NO_MATCH]]);
    await settled("burst B settled on no match", noMatchFor(NO_MATCH));
    await new Promise((r) => setTimeout(r, 1500));
    check(noMatchFor(NO_MATCH)(await view()), `burst B changed after settling: ${JSON.stringify(await view())}`);
    const states = await collect();
    truthful(states, "rapid replacement");
    const loadingStates = states.filter((s) => s.loading).length;
    check(loadingStates > 0, "Loading your library… never shown while the large listings ran");
    check(!states.some((s) => s.noMatch && s.query !== NO_MATCH), `no-match shown for another query: ${JSON.stringify(states.filter((s) => s.noMatch && s.query !== NO_MATCH).slice(0, 3))}`);
    await clickLabel("Clear search");
    await settled("cleared after the bursts", showing("", TOTAL), 60000);
    report.burst_states = { observed: states.length, loading: loadingStates, no_match: states.filter((s) => s.noMatch).length };
    return report.burst_states;
  });

  await step("I4 importing the same sheet again creates nothing; every library file byte- and mtime-identical", async () => {
    await observe();
    const shown = await importThroughPanel(csv);
    check(shown.summary === `Created 0 profiles · ${UNIQUE} already in the catalog · ${DUPLICATES} duplicate rows · ${rejected.length} not imported`, `summary: ${shown.summary}`);
    check(!shown.lists["Kept unchanged, the sheet differs"], `an unchanged sheet was reported as differing: ${JSON.stringify(shown.lists["Kept unchanged, the sheet differs"]?.slice(0, 3))}`);
    await closePanel();
    await settled("all items after the rerun", showing("", TOTAL), 60000);
    const diff = changed(alphaBytes, digest(ALPHA));
    check(diff.length === 0, `the repeated import changed ${JSON.stringify(diff.slice(0, 5))}`);
    truthful(await collect(), "rerun");
    return { summary: shown.summary };
  });

  await step("I9 other libraries: beta has none of alpha's catalog; an empty library keeps its note; alpha intact", async () => {
    await rawInvoke("add_library", { path: BETA });
    await rawInvoke("add_library", { path: EMPTY });
    const author = pick(777, (r) => r.author).q;
    await setInput(SEARCH, author);
    await settled("alpha author search", showing(author, matches(author).length));
    await switchTo("beta-lib");
    await settled("beta opens on its own files, search reset", showing("", FILE_TITLES.length));
    await observe();
    check(same(await optionTexts(STATUS_SELECT), ["All statuses"]) && same(await optionTexts(RATING_SELECT), ["All ratings"]), "beta shows alpha's catalog facets");
    await setInput(SEARCH, author);
    await settled("alpha's author is not found in beta", noMatchFor(author));
    await setInput(SEARCH, "ledger");
    await settled("beta's own file", showing("ledger", 1));
    await switchTo("empty-lib");
    const note = await settled("empty-library note", (v) => v.query === "" && v.cardCount === 0 && v.emptyLibrary?.includes("No books were found") && !v.noMatch && calm(v));
    await setInput(SEARCH, titleQuery(unique[0]));
    await settled("no match in the empty library", noMatchFor(titleQuery(unique[0])));
    await clickLabel("Clear search");
    await settled("note again", (v) => v.query === "" && v.emptyLibrary?.includes("No books were found") && !v.noMatch && calm(v));
    await switchTo("alpha-lib");
    await settled("alpha back with its catalog", showing("", TOTAL), 60000);
    check(same((await optionTexts(STATUS_SELECT)).length, 4), "alpha's status facet after switching back");
    truthful(await collect(), "libraries");
    check(changed(alphaBytes, digest(ALPHA)).length === 0, "switching libraries changed alpha");
    check(!existsSync(path.join(BETA, "Catalog")) && !existsSync(path.join(EMPTY, "Catalog")), "a catalog appeared in another library");
    await shot("05-alpha-back");
    return { note: note.emptyLibrary.slice(0, 50) };
  });

  await step("I11 a failed listing is a failure, not no-match; access back recovers with the catalog", async () => {
    const author = pick(321, (r) => r.author).q;
    const title = pick(321, titleQuery).q;
    await observe();
    chmodSync(ALPHA, 0o000);
    let failed;
    try {
      await setInput(SEARCH, author);
      failed = await settled("search failure shown", (v) => v.query === author && v.failure && !v.noMatch && v.cardCount === 0 && v.count === "0 items" && !v.loading);
      check(failed.failure.startsWith(`Searching for “${author}” failed:`) && failed.failure.includes("cannot be read"), `failure does not name the search and cause: ${failed.failure}`);
      await shot("06-failed-listing");
    } finally {
      chmodSync(ALPHA, 0o755);
    }
    await setInput(SEARCH, title);
    await settled("search after access is back", showing(title, matches(title).length));
    await setInput(SEARCH, author);
    await settled("the failed search again", showing(author, matches(author).length));
    const states = await collect();
    truthful(states, "failure");
    check(!states.some((s) => s.noMatch), "a failed listing was shown as no results");
    check(changed(alphaBytes, digest(ALPHA)).length === 0, "the failed listing changed alpha");
    await setInput(SEARCH, "");
    await settled("cleared", showing("", TOTAL), 60000);
    return { failure: failed.failure };
  });

  await step("close app (session 1)", closeApp);

  await step("I8 restart: profiles, badges, facets, search and no-match read back; another import creates nothing", async () => {
    await launchApp();
    await settled("alpha reopened with its catalog", (v) => v.library === "alpha-lib" && showing("", TOTAL)(v), 60000);
    const wantStatus = ["All statuses", ...["wishlist", "queued", "available"].filter((s) => statusCount(s)).map((s) => `${BADGE[s]} (${statusCount(s)})`)];
    check(same(await optionTexts(STATUS_SELECT), wantStatus), "status facet after restart");
    await observe();
    const author = pick(777, (r) => r.author).q;
    await setInput(SEARCH, author);
    await settled("author search after restart", showing(author, matches(author).length));
    const shown = await cards();
    for (const c of shown) {
      const r = unique.find((x) => x.title === c.title);
      check(c.badges[1] === BADGE[mapStatus(r.status)], `${c.title} badge after restart ${JSON.stringify(c.badges)}`);
    }
    await setInput(SEARCH, NO_MATCH);
    await settled("no match after restart", noMatchFor(NO_MATCH));
    await clickLabel("Clear search");
    await settled("all items", showing("", TOTAL), 60000);
    const again = await importThroughPanel(csv);
    check(again.summary === `Created 0 profiles · ${UNIQUE} already in the catalog · ${DUPLICATES} duplicate rows · ${rejected.length} not imported`, `after restart: ${again.summary}`);
    await closePanel();
    await settled("all items after the import", showing("", TOTAL), 60000);
    truthful(await collect(), "restart");
    const diff = changed(alphaBytes, digest(ALPHA));
    check(diff.length === 0, `restart or import after restart changed ${JSON.stringify(diff.slice(0, 5))}`);
    check(same(digest(CATALOG), catalogBytes), "a profile changed since the first import");
    return { cards: shown.length };
  });

  await step("observer totals", () => {
    truthful(allStates, "whole run");
    report.observed_states = allStates.length;
    return { states: allStates.length, loading: allStates.filter((s) => s.loading).length, no_match: allStates.filter((s) => s.noMatch).length };
  });

  await step("close app (session 2)", closeApp);

  stopWatchdog();
  await finish(0, "pass");
} catch {
  stopWatchdog();
  await finish(1, "fail");
}
