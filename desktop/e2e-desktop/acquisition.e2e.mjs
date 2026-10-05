// PBK-21 Drop safety journey, packaged: drives the built ProperBooky binary
// (tauri-driver/WebKitWebDriver, harness.mjs) through Acquire -> "Process
// Drop folder" against a temp copy of the committed synthetic fixture library,
// synthetic catalog profiles written here, and fresh app-data. Proves, through
// the real UI -> Tauri command -> filesystem/index boundary:
//   - a confident match is renamed, filed, linked, hashed and shown on the shelf;
//   - a link, an empty file, a truncated download, an occupied destination and
//     an unmatched file stay byte-identical in Drop, each named with its reason;
//   - state survives an app restart;
//   - a failed catalog write (read-only Catalog/) leaves the filing pending
//     with an intent record; after the folder is writable again and the app
//     restarts, the next run finishes it; a further retry changes nothing.
// Ranking, matching, destination folder and search target are not exercised
// here (unchanged by this repair).
//
// Usage (Linux, inside an X server or `xvfb-run -a`; not as root unless DAC
// capabilities are dropped, e.g. capsh --drop=cap_dac_override,cap_dac_read_search --):
//   E2E_APP=/path/to/desktop node e2e-desktop/acquisition.e2e.mjs
// Environment as in harness.mjs; default whole-run watchdog 480000ms.

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  report,
  setInput,
  setTempRoot,
  sha256,
  startDriver,
  startWatchdog,
  step,
  stopWatchdog,
  waitFor,
} from "./harness.mjs";

const AUTHOR = "Synthetic Courier";
const BOOK = {
  filed: { title: "Lumen Harbour Chronicle", status: "queued", drop: `${AUTHOR} - Lumen Harbour Chronicle (2021, Fixture Press) - libgen.li.epub` },
  retried: { title: "Copper Tide Ledger", status: "wishlist", drop: `Copper Tide Ledger (${AUTHOR}) (Z-Library).pdf` },
  link: { title: "Mirror Link Compendium", status: "queued", drop: `${AUTHOR} - Mirror Link Compendium.pdf` },
  empty: { title: "Hollow Empty Treatise", status: "queued", drop: `${AUTHOR} - Hollow Empty Treatise.epub` },
  partial: { title: "Halfway Arrival Manual", status: "queued", drop: `${AUTHOR} - Halfway Arrival Manual.pdf` },
  occupied: { title: "Occupied Shelf Primer", status: "queued", drop: `${AUTHOR} - Occupied Shelf Primer (Z-Library).pdf` },
};
const STRANGER = "random-notes-2015.pdf";
const INBOX = "Library/00 Inbox";
const filedName = (b, ext) => `${AUTHOR} - ${b.title}.${ext}`;
const EPUB = path.join(fixturesDir, "Zephyr Lantern Field Notes.epub");
const PDF = path.join(fixturesDir, "basalt-ledger-handbook.pdf");
const PANEL = '.acquire-panel[aria-label="Acquisition queue"]';
const SEARCH = '.toolbar input[type="search"]';
const LEFT = {
  [BOOK.link.drop]: "left-unsafe",
  [BOOK.empty.drop]: "left-incomplete",
  [BOOK.partial.drop]: "left-incomplete",
  [BOOK.occupied.drop]: "left-conflict",
  [STRANGER]: "left-unmatched",
};

let tempRoot = null;
let LIB = null;
let OUTSIDE = null;

const md = (b) => path.join(LIB, "Catalog", `${AUTHOR} - ${b.title}.md`);
const intents = () => {
  const dir = path.join(LIB, ".properbooky/acquisition/drop");
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : [];
};
/** Frontmatter fields of a catalog profile (flat `key: value` lines). */
function front(file) {
  const text = readFileSync(file, "utf8");
  const block = text.split("---")[1] ?? "";
  const out = { body_kept: text.includes("Kept note.") };
  for (const line of block.split("\n")) {
    const m = /^([a-z_]+): (.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
  }
  return out;
}
/** Every entry under `dir` except `.properbooky`: relative path -> sha256 / "symlink" / "dir". */
function digest(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = path.relative(dir, full);
      if (rel === ".properbooky") continue;
      if (entry.isSymbolicLink()) out[rel] = "symlink";
      else if (entry.isDirectory()) (out[rel] = "dir"), walk(full);
      else out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(dir);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- UI -------------------------------------------------------------------------

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

/** Open Acquire, click "Process Drop folder", return what the panel reports. */
async function processDrop() {
  if (!(await browser.execute((p) => Boolean(document.querySelector(p)), PANEL))) await clickLabel("Acquire");
  await waitFor("Acquire panel", () => browser.execute((p) => Boolean(document.querySelector(p)), PANEL), RESPONSIVE_MS);
  // Clear a previous report so the next one is unambiguously this run's.
  await browser.execute(() => document.querySelector(".acquire-report")?.remove());
  await clickLabel("Process Drop folder");
  const shown = await waitFor(
    "Drop report",
    () =>
      browser.execute((p) => {
        const panel = document.querySelector(p);
        const summary = panel?.querySelector(".acquire-report")?.textContent.trim();
        const busy = Array.from(panel?.querySelectorAll("button") ?? []).some((b) => b.textContent.trim() === "Filing…");
        if (!summary || busy) return null;
        return {
          summary,
          filed: Array.from(panel.querySelectorAll(".acquire-filed")).map((s) => s.textContent.trim()),
          notFiled: Array.from(panel.querySelectorAll('ul[aria-label="Not filed"] li')).map((li) => ({
            result: li.dataset.result,
            text: li.textContent.trim(),
          })),
          error: panel.querySelector(".acquire-drop > p.status")?.textContent.trim() ?? null,
        };
      }, PANEL),
    30000,
  );
  return shown;
}

async function closePanel() {
  await browser.execute((p) => document.querySelector(`${p} button[aria-label="Close"]`)?.click(), PANEL);
  await waitFor("Acquire panel closed", async () => !(await browser.execute((p) => Boolean(document.querySelector(p)), PANEL)), RESPONSIVE_MS);
}

/** The badge text of the card titled `title` after searching for it. */
async function shelfBadge(title) {
  await waitFor(
    "enabled library search",
    () => browser.execute((s) => {
      const el = document.querySelector(s);
      return Boolean(el && !el.disabled);
    }, SEARCH),
    30000,
  );
  await setInput(SEARCH, title);
  return waitFor(
    `card "${title}" with a badge`,
    () =>
      browser.execute((t) => {
        const card = Array.from(document.querySelectorAll(".grid .card")).find((c) => c.querySelector("h2")?.textContent.trim() === t);
        return card?.querySelector(".card-badges .badge")?.textContent.trim() ?? null;
      }, title),
    15000,
  );
}

const notFiledMatches = (shown, expected) => {
  const got = Object.fromEntries(
    shown.notFiled.map((n) => [Object.keys(expected).find((name) => n.text.startsWith(`${name}:`)) ?? n.text, n.result]),
  );
  return same(Object.fromEntries(Object.entries(got).sort()), Object.fromEntries(Object.entries(expected).sort()));
};

// --- run ---------------------------------------------------------------------------

startWatchdog(480000);
try {
  await step("app binary and fixtures", () => {
    check(existsSync(APP), `app binary not found: ${APP}`);
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    report.fixtures = [EPUB, PDF].map((f) => ({ name: path.basename(f), sha256: sha256(f) }));
    return { app_sha256: report.app.sha256 };
  });

  tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  LIB = path.join(tempRoot, "library");
  OUTSIDE = path.join(tempRoot, "outside");
  const dataDir = path.join(tempRoot, "data");

  await step("synthetic library: fixtures, catalog profiles, Drop arrivals; permissions are enforced", () => {
    cpSync(fixturesDir, LIB, { recursive: true });
    for (const d of ["data", "config", "cache", "state", "outside", "library/Catalog", "library/Drop", `library/${INBOX}`]) {
      mkdirSync(path.join(tempRoot, d), { recursive: true });
    }
    for (const b of Object.values(BOOK)) {
      writeFileSync(md(b), `---\ntitle: ${b.title}\nauthor: ${AUTHOR}\nstatus: ${b.status}\n---\n\nKept note.\n`);
    }
    const drop = (name) => path.join(LIB, "Drop", name);
    copyFileSync(EPUB, drop(BOOK.filed.drop));
    copyFileSync(PDF, path.join(OUTSIDE, "outside.pdf"));
    symlinkSync(path.join(OUTSIDE, "outside.pdf"), drop(BOOK.link.drop));
    writeFileSync(drop(BOOK.empty.drop), "");
    writeFileSync(drop(BOOK.partial.drop), readFileSync(PDF).subarray(0, 300));
    copyFileSync(PDF, drop(BOOK.occupied.drop));
    writeFileSync(path.join(LIB, INBOX, filedName(BOOK.occupied, "pdf")), "%PDF-1.4 occupant\n%%EOF\n");
    copyFileSync(PDF, drop(STRANGER));
    // The failure step needs a read-only folder to refuse writes (true for a
    // normal user; root bypasses it unless DAC capabilities are dropped).
    const probe = path.join(tempRoot, "ro-probe");
    mkdirSync(probe);
    chmodSync(probe, 0o555);
    let refused = false;
    try {
      writeFileSync(path.join(probe, "x"), "x");
    } catch {
      refused = true;
    }
    chmodSync(probe, 0o755);
    check(refused, "a read-only folder accepted a write: run as a normal user or drop DAC capabilities (see Usage)");
    rmSync(probe, { recursive: true, force: true });
    return { library: LIB, drop: readdirSync(path.join(LIB, "Drop")).sort() };
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
  await step("index the synthetic library through the first-run form", async () => {
    await waitFor("first-run form", () => browser.execute(() => Boolean(document.querySelector(".path-form input"))), 30000);
    await setInput(".path-form input", LIB);
    await waitFor("enabled Index button", () => browser.execute(() => document.querySelector('.path-form button[type="submit"]')?.disabled === false), RESPONSIVE_MS);
    await browser.$('.path-form button[type="submit"]').click();
    return { badge: await shelfBadge(BOOK.filed.title) };
  });

  const unsafeBefore = {
    link: lstatSync(path.join(LIB, "Drop", BOOK.link.drop)).isSymbolicLink(),
    outside: sha256(path.join(OUTSIDE, "outside.pdf")),
    occupant: sha256(path.join(LIB, INBOX, filedName(BOOK.occupied, "pdf"))),
    partial: sha256(path.join(LIB, "Drop", BOOK.partial.drop)),
    stranger: sha256(path.join(LIB, "Drop", STRANGER)),
  };

  let afterFirst = null;
  await step("S1 Process Drop folder: the confident match is filed; link, empty, truncated, occupied and unmatched files stay in Drop with reasons", async () => {
    const shown = await processDrop();
    check(/^Filed 1, 5 not filed/.test(shown.summary), `summary: ${JSON.stringify(shown)}`);
    check(same(shown.filed, [`✓ ${BOOK.filed.title}`]), `filed: ${JSON.stringify(shown.filed)}`);
    check(notFiledMatches(shown, LEFT), `not filed: ${JSON.stringify(shown.notFiled)}`);
    const reasons = Object.fromEntries(shown.notFiled.map((n) => [n.result, n.text]));
    check(/link/.test(reasons["left-unsafe"]), `link reason: ${reasons["left-unsafe"]}`);
    check(/already exists; nothing was overwritten/.test(reasons["left-conflict"]), `conflict reason: ${reasons["left-conflict"]}`);
    // Disk: filed under the canonical name with the dropped bytes; profile linked.
    const filed = path.join(LIB, INBOX, filedName(BOOK.filed, "epub"));
    check(existsSync(filed) && sha256(filed) === sha256(EPUB), "filed EPUB missing or changed");
    check(!existsSync(path.join(LIB, "Drop", BOOK.filed.drop)), "filed file still in Drop");
    const f = front(md(BOOK.filed));
    check(f.file === `${INBOX}/${filedName(BOOK.filed, "epub")}` && f.hash === sha256(EPUB) && f.status === "available", `profile: ${JSON.stringify(f)}`);
    check(f.original_filename === BOOK.filed.drop && f.body_kept, `original name / note: ${JSON.stringify(f)}`);
    // Everything else untouched.
    check(lstatSync(path.join(LIB, "Drop", BOOK.link.drop)).isSymbolicLink() && unsafeBefore.link, "the link left Drop");
    check(sha256(path.join(OUTSIDE, "outside.pdf")) === unsafeBefore.outside, "the outside file changed");
    check(sha256(path.join(LIB, INBOX, filedName(BOOK.occupied, "pdf"))) === unsafeBefore.occupant, "the occupant was overwritten");
    check(statSync(path.join(LIB, "Drop", BOOK.empty.drop)).size === 0, "the empty file changed");
    check(sha256(path.join(LIB, "Drop", BOOK.partial.drop)) === unsafeBefore.partial, "the truncated file changed");
    check(sha256(path.join(LIB, "Drop", BOOK.occupied.drop)) === sha256(PDF), "the conflicting download changed");
    check(sha256(path.join(LIB, "Drop", STRANGER)) === unsafeBefore.stranger, "the unmatched file changed");
    for (const b of [BOOK.link, BOOK.empty, BOOK.partial, BOOK.occupied]) check(!front(md(b)).file, `${b.title} was linked`);
    check(intents().length === 0, `intent records left: ${intents()}`);
    await closePanel();
    const badge = await shelfBadge(BOOK.filed.title);
    check(badge === "On the shelf", `card badge: ${badge}`);
    afterFirst = digest(LIB);
    return { summary: shown.summary, not_filed: shown.notFiled, badge };
  });

  await step("close app (session 1)", closeApp);
  await step("S2 restart: the filed book is still on the shelf; disk unchanged", async () => {
    await launchApp();
    const badge = await shelfBadge(BOOK.filed.title);
    check(badge === "On the shelf", `card badge after restart: ${badge}`);
    check(same(digest(LIB), afterFirst), "restart changed library files");
    return { badge };
  });

  await step("S3 a failed catalog write (read-only Catalog/) leaves the filing pending with its intent record", async () => {
    copyFileSync(PDF, path.join(LIB, "Drop", BOOK.retried.drop));
    const before = readFileSync(md(BOOK.retried), "utf8");
    chmodSync(path.join(LIB, "Catalog"), 0o555);
    let shown;
    try {
      shown = await processDrop();
    } finally {
      chmodSync(path.join(LIB, "Catalog"), 0o755);
    }
    const pending = shown.notFiled.find((n) => n.text.startsWith(`${BOOK.retried.drop}:`));
    check(pending?.result === "pending" && /catalog could not be updated/.test(pending.text), `pending outcome: ${JSON.stringify(shown)}`);
    check(/^Filed 0, 6 not filed/.test(shown.summary), `summary: ${shown.summary}`);
    check(readFileSync(md(BOOK.retried), "utf8") === before, "the profile changed although its write failed");
    const records = intents();
    check(records.length === 1, `intent records: ${records}`);
    const intent = JSON.parse(readFileSync(path.join(LIB, ".properbooky/acquisition/drop", records[0]), "utf8"));
    check(intent.original_filename === BOOK.retried.drop && intent.target === `${INBOX}/${filedName(BOOK.retried, "pdf")}`, `intent: ${JSON.stringify(intent)}`);
    check(sha256(path.join(LIB, intent.target)) === sha256(PDF), "published bytes differ");
    return { pending: pending.text, intent };
  });

  await step("close app (session 2)", closeApp);
  let afterRecovery = null;
  await step("S4 restart and retry: the interrupted filing is finished; original name recorded; intent cleared", async () => {
    await launchApp();
    const shown = await processDrop();
    check(/^Filed 1, 5 not filed/.test(shown.summary), `summary: ${JSON.stringify(shown)}`);
    check(same(shown.filed, [`✓ ${BOOK.retried.title}`]), `filed: ${JSON.stringify(shown.filed)}`);
    check(notFiledMatches(shown, LEFT), `not filed: ${JSON.stringify(shown.notFiled)}`);
    const f = front(md(BOOK.retried));
    check(f.file === `${INBOX}/${filedName(BOOK.retried, "pdf")}` && f.hash === sha256(PDF) && f.status === "available", `profile: ${JSON.stringify(f)}`);
    check(f.original_filename === BOOK.retried.drop && f.body_kept, `original name / note: ${JSON.stringify(f)}`);
    check(intents().length === 0, `intent records left: ${intents()}`);
    await closePanel();
    const badge = await shelfBadge(BOOK.retried.title);
    check(badge === "On the shelf", `card badge: ${badge}`);
    afterRecovery = digest(LIB);
    return { summary: shown.summary, badge };
  });

  await step("S5 a further retry files nothing and changes nothing", async () => {
    const shown = await processDrop();
    check(/^Filed 0, 5 not filed/.test(shown.summary), `summary: ${shown.summary}`);
    check(notFiledMatches(shown, LEFT), `not filed: ${JSON.stringify(shown.notFiled)}`);
    check(same(digest(LIB), afterRecovery), "a retry changed library files");
    check(intents().length === 0, "a retry left an intent record");
    return { summary: shown.summary };
  });

  await step("close app (session 3)", closeApp);
  stopWatchdog();
  await finish(0, "pass");
} catch {
  stopWatchdog();
  await finish(1, "fail");
}
