// PBK-15 multiple libraries, packaged: drives the built ProperBooky binary
// (tauri-driver/WebKitWebDriver, harness.mjs) through the library switcher,
// the native GTK folder picker (driven with xdotool) and the readers, against
// temp copies of the committed synthetic fixtures with fresh app-data.
//
// Two libraries collide on purpose: beta is a copy of alpha made after
// alpha's first scan, so both hold the same relative paths and the same
// identity UUIDs. Isolation is asserted on disk (each library's sidecars,
// index and export folder) as well as in the UI. Restart, missing/moved,
// unreadable and empty folders, unwritable/corrupt settings and a corrupt
// index are created in the temp tree only.
//
// Usage (Linux, inside an X server or `xvfb-run -a`, xdotool installed):
//   E2E_APP=/path/to/desktop node e2e-desktop/libraries.e2e.mjs
// Folder permission cases need permission checks to apply to this process:
// run as a non-root user, or as root under
//   capsh --drop=cap_dac_override,cap_dac_read_search -- -c '…'
// Environment as in harness.mjs; default whole-run watchdog 600000ms.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
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
  invoke,
  launchApp,
  listTree,
  log,
  pdfPage,
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

const ZEPHYR = "Zephyr Lantern Field Notes";
const QUILL = "quillfeather orbit atlas";
const BASALT = "basalt ledger handbook";
const AMBER = "amber orchard ledger"; // alpha only
const COBALT = "cobalt harbor almanac"; // beta only
const QUICK = "Quick Harbor Article"; // saved into beta (control)
const SLOW = "Slow Harbor Article"; // started in beta, switched away
const QUILL_REL = "quillfeather-orbit-atlas.pdf";
const ALPHA_TITLES = [ZEPHYR, AMBER, BASALT, QUILL].sort();
const BETA_TITLES = [ZEPHYR, BASALT, COBALT, QUILL].sort();
const BETA_WITH_ARTICLE = [...BETA_TITLES, QUICK].sort();
const APP_ID = "com.nadeemramli.properbooky";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));

// --- disk helpers ------------------------------------------------------------

let tempRoot, appDir, A, B, EMPTY, LOCKED, MOVED, LINK, VAULT_ONE, VAULT_TWO, OUTSIDE;

/** Every file under `dir` (dotfiles included) with its hash. */
function digest(dir) {
  return listTree(dir)
    .map((f) => `${f.path}:${sha256(path.join(dir, f.path))}`)
    .sort();
}

function identities(root) {
  return JSON.parse(readFileSync(path.join(root, ".properbooky/identities.json"), "utf8"));
}

function sidecar(root, relative) {
  const record = identities(root).records.findLast((r) => r.path === relative);
  if (!record?.state_file) return null;
  const file = path.join(root, ".properbooky/state", record.state_file);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

const settingsFile = () => path.join(appDir, "settings.json");
const settings = () => JSON.parse(readFileSync(settingsFile(), "utf8"));
const indexFile = (id) => path.join(appDir, "libraries", id, "library.db");

/** Folder permission checks apply to this process (and so to the app). */
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

// --- native picker (GTK file chooser, no window manager under Xvfb) ----------

const xdo = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();
const findWindow = (title) => {
  try {
    // GTK keeps a dismissed chooser around unmapped; only a visible one counts.
    return xdo("search", "--onlyvisible", "--name", title).split("\n")[0] || null;
  } catch {
    return null;
  }
};

async function pickerWindow(title) {
  return waitFor(`native folder picker "${title}"`, async () => findWindow(title), 15000);
}

/** Choose `folder` in the real picker, as a keyboard user would. */
async function pickFolder(title, folder) {
  const win = await pickerWindow(title);
  xdo("windowfocus", "--sync", win);
  await sleep(400);
  xdo("key", "alt+Home"); // leave "Recent", where typed locations do not apply
  await sleep(400);
  xdo("key", "ctrl+l");
  await sleep(200);
  xdo("type", "--delay", "10", folder);
  await sleep(600);
  // GTK may inline-complete a lone subfolder (e.g. ".properbooky") as
  // selected text; drop it so exactly the typed folder is chosen.
  xdo("key", "Delete");
  await sleep(200);
  xdo("key", "Return");
  await waitFor(`picker "${title}" closed`, async () => !findWindow(title), 10000);
  return { window: win };
}

/** Dismiss the picker with Escape (the first may only close its search). */
async function cancelPicker(title) {
  const win = await pickerWindow(title);
  xdo("windowfocus", "--sync", win);
  await sleep(300);
  let presses = 0;
  while (findWindow(title) && presses < 3) {
    xdo("key", "Escape");
    presses += 1;
    await sleep(700);
  }
  await waitFor(`picker "${title}" closed`, async () => !findWindow(title), 5000);
  return { escape_presses: presses };
}

// --- UI helpers ----------------------------------------------------------------

const click = (selector) =>
  browser.execute((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`no element ${s}`);
    el.click();
  }, selector);

// A WebDriver click on a still-disabled button is silently ignored, so wait
// for the button to exist and be enabled (React re-renders after input).
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

const exists = (selector) => browser.execute((s) => Boolean(document.querySelector(s)), selector);
const present = (selector, timeout = RESPONSIVE_MS) => waitFor(`${selector} shown`, () => exists(selector), timeout);
const absent = (selector, timeout = RESPONSIVE_MS) => waitFor(`${selector} gone`, async () => !(await exists(selector)), timeout);

const text = (selector) =>
  browser.execute((s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent.trim()).join(" | "), selector);

const switcherName = () =>
  browser.execute(() => {
    const el = document.querySelector(".library-switcher");
    return el ? el.childNodes[1]?.textContent.trim() ?? null : null;
  });

async function rows() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".library-row")).map((row) => ({
      id: row.getAttribute("data-library-id"),
      name: row.querySelector(".library-name").childNodes[0].textContent.trim(),
      path: row.querySelector(".library-path").textContent.trim(),
      state: row.querySelector(".library-state").textContent.trim(),
      count: row.querySelector(".library-count").textContent.trim(),
      active: row.getAttribute("aria-current") === "true",
      problem: row.querySelector(".library-problem")?.textContent.trim() ?? null,
      buttons: Array.from(row.querySelectorAll("button")).map((b) => b.textContent.trim()),
    })),
  );
}

async function openDialog() {
  if (!(await exists(".libraries-dialog"))) await click(".library-switcher");
  await present(".libraries-dialog");
}

async function closeDialog() {
  if (await exists(".libraries-dialog")) await click(".libraries-dialog .panel-close");
  await absent(".libraries-dialog");
}

/** The workspace of `name` is open with exactly `titles` in its grid. */
async function opened(name, titles, timeout = 30000) {
  await waitFor(`library "${name}" open`, async () => (await switcherName()) === name, timeout);
  return waitTitles(titles, timeout);
}

async function pastePath(folder) {
  await setInput(".path-form input", folder);
  await waitFor(
    "enabled path button",
    () => browser.execute(() => document.querySelector('.path-form button[type="submit"]')?.disabled === false),
    RESPONSIVE_MS,
  );
  await click('.path-form button[type="submit"]');
}

const VAULT_INPUT = '.acquire-panel[aria-label="Obsidian sync"] .path-form input';
async function setVaultInput(folder) {
  await present(VAULT_INPUT);
  await setInput(VAULT_INPUT, folder);
  await waitFor("vault path kept in the field", () => browser.execute((s, v) => document.querySelector(s)?.value === v, VAULT_INPUT, folder), RESPONSIVE_MS);
}

// --- Obsidian export through the panel (PBK-26 exporter, PBK-15 ownership) --

const PANEL = '.acquire-panel[aria-label="Obsidian sync"]';
const notesIn = (vault) => {
  const dir = path.join(vault, "Properbooky");
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")).sort() : [];
};
const noteText = (vault, name) => readFileSync(path.join(vault, "Properbooky", name), "utf8");

/** Sync through the real panel; returns the report or the refusal shown. */
async function syncThroughPanel(vault) {
  await clickLabel("Obsidian");
  await present(PANEL);
  await setVaultInput(vault);
  await clickLabel("Sync highlights now");
  const outcome = await waitFor(
    "export outcome",
    () =>
      browser.execute((p) => {
        const report = document.querySelector(".acquire-report")?.textContent.trim();
        const status = Array.from(document.querySelectorAll(`${p} .status`)).map((e) => e.textContent.trim()).join(" | ");
        return report || status ? { report: report || null, status: status || null } : null;
      }, PANEL),
    15000,
  );
  await clickLabel("Close");
  await absent(PANEL);
  return outcome;
}

async function search(term, expected) {
  await setInput('.toolbar input[type="search"]', term);
  return waitTitles(expected);
}

async function cardProgress(title) {
  return browser.execute((t) => {
    const card = Array.from(document.querySelectorAll(".grid .card")).find(
      (c) => c.querySelector("h2")?.textContent.trim() === t,
    );
    if (!card) return "no card";
    return card.querySelector('.card-progress[role="progressbar"]')?.getAttribute("aria-valuenow") ?? null;
  }, title);
}

async function readCard(title) {
  await waitFor(
    `Read on "${title}"`,
    () =>
      browser.execute((t) => {
        const card = Array.from(document.querySelectorAll(".grid .card")).find(
          (c) => c.querySelector("h2")?.textContent.trim() === t,
        );
        const button = card?.querySelector(".read-book");
        if (!button) return false;
        button.click();
        return true;
      }, title),
    RESPONSIVE_MS,
  );
}

const bookTabs = () =>
  browser.execute(() => Array.from(document.querySelectorAll(".tab-list .tab-title")).map((t) => t.childNodes[0].textContent.trim()));

const libraryState = () => invoke("get_library_state");

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

// --- synthetic article server (local, deterministic) --------------------------

function articleHtml(title) {
  const paragraph = (n) =>
    `<p>${title} paragraph ${n}. Synthetic harbor notes describe tides, lanterns and ledgers in plain sentences so the readability extractor keeps them as article body text.</p>`;
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${Array.from({ length: 12 }, (_, i) => paragraph(i + 1)).join("")}</article></body></html>`;
}

let releaseSlow = null;
let slowRequested = false;
let slowAnswered = false;
const server = http.createServer((req, res) => {
  if (req.url === "/quick") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(articleHtml(QUICK));
  } else if (req.url === "/slow") {
    slowRequested = true;
    releaseSlow = () => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(articleHtml(SLOW), () => (slowAnswered = true));
    };
  } else {
    res.writeHead(404).end();
  }
});

// ---------------------------------------------------------------------------------

startWatchdog(600000);
try {
  await step("app binary, fixtures and xdotool present", async () => {
    check(existsSync(APP), `binary not found: ${APP} (build it first)`);
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    report.fixtures = readdirSync(fixturesDir)
      .sort()
      .map((name) => ({ name, sha256: sha256(path.join(fixturesDir, name)) }));
    check(report.fixtures.length === 3, `expected 3 fixture books, found ${report.fixtures.length}`);
    const xdotool = execFileSync("xdotool", ["version"], { encoding: "utf8" }).trim();
    return { app_sha256: report.app.sha256, xdotool };
  });

  tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  const dataDir = path.join(tempRoot, "data");
  appDir = path.join(dataDir, APP_ID);
  const libs = path.join(tempRoot, "libs");
  A = path.join(libs, "alpha-shelf");
  B = path.join(libs, "beta-shelf");
  EMPTY = path.join(libs, "empty-shelf");
  LOCKED = path.join(libs, "locked-shelf");
  MOVED = path.join(libs, "alpha-shelf-moved");
  LINK = path.join(libs, "alpha-link");
  VAULT_ONE = path.join(tempRoot, "vaults", "one");
  VAULT_TWO = path.join(tempRoot, "vaults", "two");
  OUTSIDE = path.join(tempRoot, "outside");

  let enforced = false;
  await step("fresh isolated app-data, alpha library copy, vaults", () => {
    for (const d of ["data", "config", "cache", "state"]) mkdirSync(path.join(tempRoot, d));
    cpSync(fixturesDir, A, { recursive: true });
    cpSync(path.join(A, QUILL_REL), path.join(A, "amber-orchard-ledger.pdf"));
    for (const d of [VAULT_ONE, VAULT_TWO, OUTSIDE]) mkdirSync(d, { recursive: true });
    enforced = permissionsEnforced();
    check(
      enforced,
      "folder permissions are not enforced for this process (root with DAC override); run as a non-root user or under capsh --drop=cap_dac_override,cap_dac_read_search",
    );
    report.temp_root = tempRoot;
    return { root: tempRoot, permissions_enforced: enforced };
  });

  await step("synthetic article server on loopback", async () => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { port: server.address().port };
  });
  const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;

  const env = {
    ...process.env,
    PB_E2E_RUN: RUN_ID,
    XDG_DATA_HOME: dataDir,
    XDG_CONFIG_HOME: path.join(tempRoot, "config"),
    XDG_CACHE_HOME: path.join(tempRoot, "cache"),
    XDG_STATE_HOME: path.join(tempRoot, "state"),
  };
  await step("tauri-driver ready", () => startDriver(env));

  // ---- Session 1 ----------------------------------------------------------------
  await step("launch packaged app: tab rail visible", launchApp);

  await step("C1 first run: no library, no predetermined location", async () => {
    const state = await libraryState();
    check(state.library_id === null && state.library_path === null, `not fresh: ${JSON.stringify(state)}`);
    const list = await invoke("list_libraries");
    check(list.libraries.length === 0 && list.active_id === null, `libraries on first run: ${JSON.stringify(list)}`);
    check((await rows()).length === 0, "known-library rows on first run");
    const value = await browser.execute(() => document.querySelector(".path-form input")?.value);
    check(value === "", `path field prefilled: ${value}`);
    check(await exists(".library-open-folder"), "no Open folder as library button");
    check(!existsSync(settingsFile()), "settings written before any choice");
    await shot("01-first-run-launcher");
    return { libraries: 0, path_field: value };
  });

  let alphaId, betaId;
  await step("C1 open alpha through the first-run path form", async () => {
    await pastePath(A);
    const status = await waitFor("scan status", () => browser.execute(() => document.querySelector(".status")?.textContent.trim() || null), 30000);
    check(status === "Indexed 4 books", `scan reported ${status}`);
    const titles = await opened("alpha-shelf", ALPHA_TITLES);
    alphaId = (await libraryState()).library_id;
    return { status, ...titles, id: alphaId };
  });

  await step("C1 launcher shows name, path and the actual indexed count", async () => {
    await openDialog();
    const list = await rows();
    check(list.length === 1, `rows ${JSON.stringify(list)}`);
    const [row] = list;
    check(row.name === "alpha-shelf" && row.path === A && row.active, `row ${JSON.stringify(row)}`);
    check(row.count === "4 books indexed" && row.state === "Available", `row facts ${JSON.stringify(row)}`);
    const saved = settings();
    check(saved.active === alphaId && saved.libraries.length === 1 && saved.libraries[0].path === A, `settings ${JSON.stringify(saved)}`);
    check(existsSync(indexFile(alphaId)), "alpha index not in its own file");
    await closeDialog();
    return { row, settings: saved };
  });

  await step("fixture: beta copied from alpha after its scan (colliding paths and UUIDs)", () => {
    cpSync(A, B, { recursive: true });
    rmSync(path.join(B, "amber-orchard-ledger.pdf"));
    cpSync(path.join(B, "basalt-ledger-handbook.pdf"), path.join(B, "cobalt-harbor-almanac.pdf"));
    const a = identities(A).records.find((r) => r.path === QUILL_REL);
    const b = identities(B).records.find((r) => r.path === QUILL_REL);
    check(a && b && a.id === b.id, "beta does not share alpha's identity for the colliding book");
    return { colliding_relative_path: QUILL_REL, shared_uuid: a.id };
  });

  await step("C4 canceled picker changes nothing", async () => {
    const before = readFileSync(settingsFile());
    await openDialog();
    await click(".library-open-folder");
    const cancelled = await cancelPicker("Open folder as library");
    const message = await waitFor("cancel message", () => text(".launcher-message"), RESPONSIVE_MS);
    check(message === "No folder was chosen; nothing changed.", `message ${message}`);
    check(Buffer.compare(before, readFileSync(settingsFile())) === 0, "settings changed after cancel");
    check((await rows()).length === 1 && (await switcherName()) === "alpha-shelf", "library list or open library changed");
    return { message, ...cancelled };
  });

  await step("C1 open beta through the native folder picker", async () => {
    await click(".library-open-folder");
    const picked = await pickFolder("Open folder as library", B);
    const titles = await opened("beta-shelf", BETA_TITLES);
    const status = await text(".status");
    check(status === "Indexed 4 books", `beta scan ${status}`);
    betaId = (await libraryState()).library_id;
    check(betaId && betaId !== alphaId, "beta has no own id");
    return { ...picked, ...titles, status, id: betaId };
  });

  await step("C1 both libraries listed with their own counts and index files", async () => {
    await openDialog();
    const list = await rows();
    check(list.length === 2, `rows ${JSON.stringify(list)}`);
    const alpha = list.find((r) => r.id === alphaId);
    const beta = list.find((r) => r.id === betaId);
    check(alpha.name === "alpha-shelf" && alpha.path === A && alpha.count === "4 books indexed" && !alpha.active, `alpha ${JSON.stringify(alpha)}`);
    check(beta.name === "beta-shelf" && beta.path === B && beta.count === "4 books indexed" && beta.active, `beta ${JSON.stringify(beta)}`);
    check(existsSync(indexFile(alphaId)) && existsSync(indexFile(betaId)), "missing per-library index");
    await shot("02-two-libraries");
    return { rows: list };
  });

  await step("C1 the same folder in another spelling selects it, never duplicates", async () => {
    await pastePath(`${A}/`);
    await opened("alpha-shelf", ALPHA_TITLES);
    symlinkSync(A, LINK);
    await openDialog();
    await pastePath(LINK);
    await absent(".libraries-dialog");
    await openDialog();
    const list = await rows();
    check(list.length === 2, `duplicated: ${JSON.stringify(list)}`);
    check(settings().libraries.length === 2, "settings gained an entry");
    check(list.find((r) => r.active)?.id === alphaId, "alpha not selected");
    await closeDialog();
    return { spellings: [`${A}/`, LINK], rows: list.length };
  });

  await step("C3 index, search and details stay within each library", async () => {
    const alpha = { amber: await search("amber", [AMBER]), cobalt: await search("cobalt", []) };
    await search("", ALPHA_TITLES);
    await readCardDetails(BASALT, A);
    await openDialog();
    await clickLabel("Open beta-shelf");
    await opened("beta-shelf", BETA_TITLES);
    const beta = { cobalt: await search("cobalt", [COBALT]), amber: await search("amber", []) };
    await search("", BETA_TITLES);
    await readCardDetails(BASALT, B);
    return { alpha, beta };
  });

  async function readCardDetails(title, root) {
    await browser.execute((t) => {
      const card = Array.from(document.querySelectorAll(".grid .card")).find((c) => c.querySelector("h2")?.textContent.trim() === t);
      Array.from(card.querySelectorAll("button")).find((b) => b.textContent.trim() === "Review details").click();
    }, title);
    const details = await waitFor("details dialog", () => browser.execute(() => document.querySelector("dialog.book-review[open]")?.textContent ?? null), RESPONSIVE_MS);
    const other = root === A ? B : A;
    check(details.includes(root) && !details.includes(other), "details do not show this library's file");
    const books = await invoke("list_books", { query: title });
    check(books.length === 1 && books[0].path.startsWith(`${root}/`), `details from the wrong library: ${JSON.stringify(books.map((b) => b.path))}`);
    await clickLabel("Close review");
    await absent("dialog.book-review[open]");
    return details.length;
  }

  await step("C3 reading progress and highlights belong to alpha only", async () => {
    await openDialog();
    await clickLabel("Open alpha-shelf");
    await opened("alpha-shelf", ALPHA_TITLES);
    await readCard(QUILL);
    check((await pdfPage()) === "1", "alpha PDF did not open at page 1");
    await click('.reader-bar button[aria-label="Next page"]');
    await waitFor("page 2", async () => (await pdfPage()) === "2", RESPONSIVE_MS);
    await waitFor("alpha sidecar page 2", async () => sidecar(A, QUILL_REL)?.position === "2", 10000);
    const quillA = (await invoke("list_books", { query: QUILL }))[0].path;
    const added = await invoke("add_highlight", {
      path: quillA,
      text: "Alpha-only highlight",
      note: null,
      color: null,
      anchor: { type: "pdf", page: 2, quote: { exact: "Quillfeather Orbit Atlas - page 2", prefix: "", suffix: "" } },
    });
    check(sidecar(A, QUILL_REL).highlights.some((h) => h.id === added.id), "alpha highlight not in alpha sidecar");
    check(sidecar(B, QUILL_REL) === null, "beta sidecar exists before beta was read");
    return { alpha_position: "2", highlight: added.id };
  });

  await step("C3 dirty reader state lands in alpha when switching mid-read", async () => {
    const betaBefore = digest(B);
    await click('.reader-bar button[aria-label="Next page"]');
    await click(".library-switcher");
    await present(".libraries-dialog");
    await clickLabel("Open beta-shelf");
    await opened("beta-shelf", BETA_TITLES);
    check((await bookTabs()).length === 0, `alpha's reader tab followed into beta: ${await bookTabs()}`);
    const alphaState = sidecar(A, QUILL_REL);
    check(alphaState.position === "3", `alpha sidecar at ${alphaState.position}, expected the last page turned (3)`);
    check(JSON.stringify(digest(B)) === JSON.stringify(betaBefore), "switching wrote into beta");
    check((await cardProgress(QUILL)) === null, `beta shows alpha's progress: ${await cardProgress(QUILL)}`);
    await readCard(QUILL);
    check((await pdfPage()) === "1", "beta's copy opened at alpha's page");
    await click('.reader-bar button[aria-label="Show highlights"]');
    const panel = await waitFor("highlights panel", () => browser.execute(() => document.querySelector(".highlights-panel")?.textContent ?? null), RESPONSIVE_MS);
    check(!panel.includes("Alpha-only highlight"), "alpha's highlight shown in beta");
    const betaSidecar = await invoke("get_sidecar", { path: path.join(B, QUILL_REL) });
    check(betaSidecar.highlights.length === 0, "beta sidecar has highlights");
    await shot("03-beta-reader-isolated");
    await click("#tab-library");
    await waitTitles(BETA_TITLES);
    return { alpha: alphaState.position, beta_page: "1", beta_panel: panel.slice(0, 80) };
  });

  await step("C3 control: an article saved in beta lands in beta", async () => {
    await clickLabel("Save URL");
    await setInput(".url-form input", url("/quick"));
    await click('.url-form button[type="submit"]');
    const status = await waitFor("saved status", () => browser.execute(() => document.querySelector(".status")?.textContent.trim() || null), 30000);
    check(status === `Saved “${QUICK}” to the library`, `save status ${status}`);
    await waitTitles(BETA_WITH_ARTICLE, 15000);
    check(readdirSync(path.join(B, "Articles")).length === 1, "article not in beta");
    check(!existsSync(path.join(A, "Articles")), "article in alpha");
    return { status };
  });

  await step("C3 stale download: switched away before it finished, nothing is written anywhere", async () => {
    const alphaBefore = digest(A);
    const betaBefore = digest(B);
    await clickLabel("Save URL");
    await setInput(".url-form input", url("/slow"));
    await click('.url-form button[type="submit"]');
    await waitFor("slow request reached the server", async () => slowRequested, 15000);
    await openDialog();
    await clickLabel("Open alpha-shelf");
    await opened("alpha-shelf", ALPHA_TITLES);
    releaseSlow();
    await waitFor("slow response delivered", async () => slowAnswered, 10000);
    await sleep(3000);
    check(JSON.stringify(digest(A)) === JSON.stringify(alphaBefore), "stale download wrote into alpha");
    check(JSON.stringify(digest(B)) === JSON.stringify(betaBefore), "stale download wrote into beta after the switch");
    await waitTitles(ALPHA_TITLES);
    const status = await text(".status");
    check(!status.includes(SLOW), `alpha shows beta's result: ${status}`);
    return { alpha_unchanged: alphaBefore.length, beta_unchanged: betaBefore.length, status };
  });

  await step("C3/C4 late writes bound to beta are refused while alpha is open", async () => {
    const betaBefore = digest(B);
    const sharedId = identities(B).records.find((r) => r.path === QUILL_REL).id;
    const progress = await expectRefused(
      rawInvoke("save_progress", { libraryId: betaId, path: path.join(B, QUILL_REL), position: "3", percent: 1 }),
      /not open any more/,
      "beta-bound save_progress",
    );
    const edit = { title: "Hijacked", author: null, category: null, content_type: "book", reading_status: "finished", want_to_read: false, up_next: false };
    const update = await expectRefused(rawInvoke("update_book", { libraryId: betaId, id: sharedId, edit }), /not open any more/, "beta-bound update_book with a colliding id");
    const crossPath = await expectRefused(
      invoke("save_progress", { path: path.join(B, QUILL_REL), position: "3", percent: 1 }),
      /outside the library/,
      "alpha-bound write to a beta path",
    );
    check(JSON.stringify(digest(B)) === JSON.stringify(betaBefore), "beta changed");
    check(!existsSync(path.join(A, ".properbooky/curation.json")), "colliding id edited alpha");
    return { progress, update, crossPath };
  });

  await step("C3 export: one Obsidian folder per library", async () => {
    await clickLabel("Obsidian");
    await setVaultInput(VAULT_ONE);
    await clickLabel("Sync highlights now");
    const result = await waitFor("alpha export", () => text(".acquire-report"), 15000);
    check(/Exported 1 highlights across 1 note/.test(result), `alpha export ${result}`);
    const out = path.join(VAULT_ONE, "Properbooky");
    const notes = readdirSync(out).filter((f) => f.endsWith(".md"));
    check(notes.length === 1 && readFileSync(path.join(out, notes[0]), "utf8").includes("Alpha-only highlight"), `alpha notes ${notes}`);
    check(JSON.parse(readFileSync(path.join(out, ".properbooky-library"), "utf8")).library_id === alphaId, "export marker");
    await clickLabel("Close");
    const vaultOne = digest(VAULT_ONE);

    await openDialog();
    await clickLabel("Open beta-shelf");
    await opened("beta-shelf", BETA_WITH_ARTICLE);
    await invoke("add_highlight", {
      path: path.join(B, QUILL_REL),
      text: "Beta-only highlight",
      note: null,
      color: null,
      anchor: { type: "pdf", page: 1, quote: { exact: "Quillfeather Orbit Atlas - page 1", prefix: "", suffix: "" } },
    });
    await clickLabel("Obsidian");
    await setVaultInput(VAULT_ONE);
    await clickLabel("Sync highlights now");
    const refusal = await waitFor("shared folder refused", () => text('.acquire-panel[aria-label="Obsidian sync"] .status'), 15000);
    check(/library “alpha-shelf”/.test(refusal), `refusal ${refusal}`);
    check(JSON.stringify(digest(VAULT_ONE)) === JSON.stringify(vaultOne), "alpha's export folder changed");
    await shot("04-export-folder-refused");
    await setVaultInput(VAULT_TWO);
    await clickLabel("Sync highlights now");
    const betaResult = await waitFor("beta export", () => text(".acquire-report"), 15000);
    check(/Exported 1 highlights across 1 note/.test(betaResult), `beta export ${betaResult}`);
    const betaNotes = readdirSync(path.join(VAULT_TWO, "Properbooky")).filter((f) => f.endsWith(".md"));
    const betaNote = readFileSync(path.join(VAULT_TWO, "Properbooky", betaNotes[0]), "utf8");
    check(betaNote.includes("Beta-only highlight") && !betaNote.includes("Alpha-only"), "beta note content");
    check(JSON.stringify(digest(VAULT_ONE)) === JSON.stringify(vaultOne), "alpha's export folder changed");
    await clickLabel("Close");
    return { alpha: result, refusal, beta: betaResult };
  });

  await step("I4/I7 user-authored export content is preserved and never crosses libraries", async () => {
    // Private text inside each generated note (outside the regenerated
    // block) and a note the user owns in alpha's export folder.
    const [alphaNote] = notesIn(VAULT_ONE);
    const [betaNote] = notesIn(VAULT_TWO);
    check(alphaNote && betaNote, `notes ${alphaNote} / ${betaNote}`);
    writeFileSync(path.join(VAULT_ONE, "Properbooky", alphaNote), `${noteText(VAULT_ONE, alphaNote)}\n## My thoughts\nPrivate alpha note: keep me.\n`);
    writeFileSync(path.join(VAULT_TWO, "Properbooky", betaNote), `${noteText(VAULT_TWO, betaNote)}\n## My thoughts\nPrivate beta note: keep me.\n`);
    writeFileSync(path.join(VAULT_ONE, "Properbooky", "My own alpha reading list.md"), "# Mine\n\nWritten by the user, not by ProperBooky.\n");
    const userOwned = sha256(path.join(VAULT_ONE, "Properbooky", "My own alpha reading list.md"));
    let vaultOne = digest(VAULT_ONE);
    let vaultTwo = digest(VAULT_TWO);

    // Beta is open: an export still bound to alpha (an old-library call in
    // flight) is refused and touches nothing.
    const stale = await expectRefused(rawInvoke("sync_obsidian", { libraryId: alphaId }), /not open any more/, "alpha-bound export while beta is open");
    check(JSON.stringify(digest(VAULT_ONE)) === JSON.stringify(vaultOne), "stale export changed alpha's folder");

    // Beta re-exports into its own folder: its private text survives and
    // alpha's folder is untouched.
    const beta = await syncThroughPanel(VAULT_TWO);
    check(/Exported 1 highlights across 1 note/.test(beta.report ?? ""), `beta export ${JSON.stringify(beta)}`);
    check(noteText(VAULT_TWO, betaNote).includes("Private beta note: keep me.") && noteText(VAULT_TWO, betaNote).includes("Beta-only highlight"), "beta note lost content");
    check(!noteText(VAULT_TWO, betaNote).includes("Alpha-only"), "alpha highlight in beta's note");
    check(JSON.stringify(digest(VAULT_ONE)) === JSON.stringify(vaultOne), "beta export changed alpha's folder");
    // Beta into alpha's folder (same relative book path, same identity UUID)
    // is refused; alpha's notes, including the private text, are unchanged.
    const crossed = await syncThroughPanel(VAULT_ONE);
    check(!crossed.report && /library “alpha-shelf”/.test(crossed.status ?? ""), `beta into alpha's folder ${JSON.stringify(crossed)}`);
    check(JSON.stringify(digest(VAULT_ONE)) === JSON.stringify(vaultOne), "alpha's folder changed by beta");
    await syncThroughPanel(VAULT_TWO); // keep beta's own folder as its setting
    vaultTwo = digest(VAULT_TWO);

    // Alpha re-exports: its private text and the user's own note survive.
    await openDialog();
    await clickLabel("Open alpha-shelf");
    await opened("alpha-shelf", ALPHA_TITLES);
    const alpha = await syncThroughPanel(VAULT_ONE);
    check(/Exported 1 highlights across 1 note/.test(alpha.report ?? ""), `alpha export ${JSON.stringify(alpha)}`);
    const text = noteText(VAULT_ONE, alphaNote);
    check(text.includes("Private alpha note: keep me.") && text.includes("Alpha-only highlight") && !text.includes("Beta-only"), "alpha note content");
    check(sha256(path.join(VAULT_ONE, "Properbooky", "My own alpha reading list.md")) === userOwned, "user's own note changed");
    check(JSON.stringify(digest(VAULT_TWO)) === JSON.stringify(vaultTwo), "alpha export changed beta's folder");
    await shot("04b-user-content-preserved");

    await openDialog();
    await clickLabel("Open beta-shelf");
    await opened("beta-shelf", BETA_WITH_ARTICLE);
    return { stale, beta: beta.report, refused: crossed.status, alpha: alpha.report };
  });

  await step("C2 rename with the keyboard; empty and cancelled names change nothing", async () => {
    await openDialog();
    await browser.execute(() => document.querySelector('button[aria-label="Rename beta-shelf"]').focus());
    await browser.keys(["Enter"]);
    await present(".library-rename input");
    await setInput(".library-rename input", "   ");
    check(await browser.execute(() => document.querySelector('.library-rename button[type="submit"]').disabled), "empty name can be saved");
    await browser.keys(["Escape"]);
    await absent(".library-rename");
    check((await rows()).find((r) => r.id === betaId).name === "beta-shelf", "cancel renamed");
    await expectRefused(invoke("rename_library", { id: betaId, name: "  " }), /needs a name/, "blank rename via IPC");
    await browser.execute(() => document.querySelector('button[aria-label="Rename beta-shelf"]').focus());
    await browser.keys(["Enter"]);
    await present(".library-rename input");
    await setInput(".library-rename input", "Archive shelf");
    await browser.execute(() => document.querySelector(".library-rename input").focus());
    await browser.keys(["Enter"]);
    await waitFor("renamed row", async () => (await rows()).find((r) => r.id === betaId)?.name === "Archive shelf", RESPONSIVE_MS);
    await closeDialog();
    check((await switcherName()) === "Archive shelf", "switcher not renamed");
    check(settings().libraries.find((l) => l.id === betaId).name === "Archive shelf", "rename not saved");
    check((await bookTabs()).length === 0 && (await waitTitles(BETA_WITH_ARTICLE)), "workspace reset by rename");
    return { name: "Archive shelf" };
  });

  let betaDigest;
  await step("C2 remove from list: explained, and nothing on disk is touched", async () => {
    await openDialog();
    await clickLabel("Open alpha-shelf");
    await opened("alpha-shelf", ALPHA_TITLES);
    betaDigest = digest(B);
    const betaIndex = sha256(indexFile(betaId));
    await openDialog();
    await clickLabel("Remove Archive shelf from the list");
    const explanation = await text(".library-remove-confirm p");
    check(/only forgets it/.test(explanation) && /stays on disk untouched/.test(explanation) && explanation.includes(B), `explanation ${explanation}`);
    await shot("05-remove-confirmation");
    await click(".library-remove-yes");
    await waitFor("row removed", async () => !(await rows()).some((r) => r.id === betaId), RESPONSIVE_MS);
    const saved = settings().libraries.find((l) => l.id === betaId);
    check(saved && typeof saved.removed_at === "number", "removal not recorded as forget-only");
    check(JSON.stringify(digest(B)) === JSON.stringify(betaDigest), "beta's folder changed");
    check(existsSync(indexFile(betaId)) && sha256(indexFile(betaId)) === betaIndex, "beta index removed or changed");
    check((await switcherName()) === "alpha-shelf", "removal changed the open library");
    await expectRefused(rawInvoke("list_books", { libraryId: betaId, query: null }), /no longer in your list/, "removed library still usable");
    return { explanation, files_kept: betaDigest.length };
  });

  await step("I5 a removed library still owns its export folder", async () => {
    // Alpha is open and beta (exported to vault two) was removed. Pointing
    // alpha at beta's folder passes the list check (beta is no longer
    // listed) but the folder's marker still names beta: refused.
    const vaultTwo = digest(VAULT_TWO);
    const refused = await syncThroughPanel(VAULT_TWO);
    check(!refused.report && /library “Archive shelf”/.test(refused.status ?? "") && /re-add it/.test(refused.status ?? ""), `removed owner ${JSON.stringify(refused)}`);
    check(JSON.stringify(digest(VAULT_TWO)) === JSON.stringify(vaultTwo), "removed library's export folder changed");
    const back = await syncThroughPanel(VAULT_ONE);
    check(/Exported 1 highlights/.test(back.report ?? ""), `alpha back to its folder ${JSON.stringify(back)}`);
    check(noteText(VAULT_ONE, notesIn(VAULT_ONE).find((n) => n !== "My own alpha reading list.md")).includes("Private alpha note: keep me."), "alpha private text lost");
    return { refused: refused.status };
  });

  await step("C2 re-add restores the same library with its data", async () => {
    await pastePath(B);
    await opened("Archive shelf", BETA_WITH_ARTICLE);
    check((await libraryState()).library_id === betaId, "re-add created a new library");
    const progress = await cardProgress(QUILL);
    check(progress !== null, "beta's own progress lost after re-add");
    const settingsView = await invoke("get_app_settings");
    check(settingsView.export_folder === path.join(VAULT_TWO, "Properbooky"), `export folder ${settingsView.export_folder}`);
    const state = await invoke("get_sidecar", { path: path.join(B, QUILL_REL) });
    check(state.highlights.some((h) => h.text === "Beta-only highlight"), "beta highlight lost");
    return { id: betaId, progress, export_folder: settingsView.export_folder };
  });

  await step("I5 after re-add, beta exports to its own folder and keeps its private text", async () => {
    const vaultOne = digest(VAULT_ONE);
    const result = await syncThroughPanel(VAULT_TWO);
    check(/Exported 1 highlights across 1 note/.test(result.report ?? ""), `beta export after re-add ${JSON.stringify(result)}`);
    const [betaNote] = notesIn(VAULT_TWO);
    check(noteText(VAULT_TWO, betaNote).includes("Private beta note: keep me."), "beta private text lost after re-add");
    check(JSON.stringify(digest(VAULT_ONE)) === JSON.stringify(vaultOne), "alpha's folder changed");
    return { report: result.report };
  });

  await step("C4 empty folder opens with an honest empty state", async () => {
    mkdirSync(EMPTY);
    await openDialog();
    await pastePath(EMPTY);
    await waitFor("empty library open", async () => (await switcherName()) === "empty-shelf", 30000);
    const message = await waitFor("empty message", () => text(".library-empty"), 15000);
    check(message.includes("No books were found") && message.includes(EMPTY), `empty message ${message}`);
    await openDialog();
    const row = (await rows()).find((r) => r.name === "empty-shelf");
    check(row.count === "0 books indexed", `empty count ${row.count}`);
    await closeDialog();
    await shot("06-empty-library");
    return { message };
  });

  await step("close app (session 1)", closeApp);

  // ---- Session 2: restart restores the list and the open library -----------
  await step("C4 restart restores the library list and the open library", async () => {
    await launchApp();
    await waitFor("empty-shelf reopened", async () => (await switcherName()) === "empty-shelf", 30000);
    await openDialog();
    const list = await rows();
    check(
      JSON.stringify(list.map((r) => [r.name, r.count]).sort()) ===
        JSON.stringify([["Archive shelf", "5 books indexed"], ["alpha-shelf", "4 books indexed"], ["empty-shelf", "0 books indexed"]]),
      `rows after restart ${JSON.stringify(list)}`,
    );
    await clickLabel("Open alpha-shelf");
    await opened("alpha-shelf", ALPHA_TITLES);
    check((await cardProgress(QUILL)) === "100", `alpha progress after restart ${await cardProgress(QUILL)}`);
    await readCard(QUILL);
    check((await pdfPage()) === "3", "alpha PDF not at its saved page");
    return { rows: list.map((r) => r.name) };
  });

  await step("I5 after restart, alpha re-exports and keeps the user's content", async () => {
    await click("#tab-library");
    await waitTitles(ALPHA_TITLES);
    const vaultTwo = digest(VAULT_TWO);
    const userOwned = sha256(path.join(VAULT_ONE, "Properbooky", "My own alpha reading list.md"));
    const result = await syncThroughPanel(VAULT_ONE);
    check(/Exported 1 highlights across 1 note/.test(result.report ?? ""), `alpha export after restart ${JSON.stringify(result)}`);
    const note = notesIn(VAULT_ONE).find((n) => n !== "My own alpha reading list.md");
    check(noteText(VAULT_ONE, note).includes("Private alpha note: keep me."), "alpha private text lost after restart");
    check(sha256(path.join(VAULT_ONE, "Properbooky", "My own alpha reading list.md")) === userOwned, "user's own note changed");
    check(JSON.stringify(digest(VAULT_TWO)) === JSON.stringify(vaultTwo), "beta's folder changed");
    return { report: result.report };
  });

  await step("close app (session 2)", closeApp);

  // ---- Session 3: missing / moved, unreadable, unwritable --------------------
  const betaBeforeMissing = digest(B);
  await step("C4 moved folder: visible, nothing opened in its place, nothing recreated", async () => {
    renameSync(A, MOVED);
    await launchApp();
    const error = await waitFor("missing-folder error", () => text(".launcher-error"), 30000);
    check(error.includes(`was not found at ${A}`) && /Nothing was opened in its place/.test(error), `error ${error}`);
    check(!(await exists(".grid")) && !(await exists(".library-switcher")), "a library workspace opened");
    const state = await libraryState();
    check(state.library_id === alphaId && state.status === "missing" && state.library_path === A, `state ${JSON.stringify(state)}`);
    const row = (await rows()).find((r) => r.id === alphaId);
    check(row.state === "Folder not found" && row.buttons.includes("Locate folder…") && row.buttons.includes("Check again"), `row ${JSON.stringify(row)}`);
    await expectRefused(invoke("list_books", { query: null }), /was not found/, "list_books on a missing folder");
    await expectRefused(invoke("save_progress", { path: path.join(A, QUILL_REL), position: "1", percent: 0 }), /was not found/, "write to a missing folder");
    await clickLabel("Check alpha-shelf again");
    await sleep(1500);
    check(!existsSync(A), "the missing folder was recreated");
    check(JSON.stringify(digest(B)) === JSON.stringify(betaBeforeMissing), "another library was written");
    const vaultOne = digest(VAULT_ONE);
    await expectRefused(invoke("sync_obsidian"), /was not found/, "export from a missing library");
    check(JSON.stringify(digest(VAULT_ONE)) === JSON.stringify(vaultOne), "export folder changed for a missing library");
    await shot("07-missing-folder");
    return { error, state };
  });

  await step("C4 locate the moved folder with the picker: data intact", async () => {
    await clickLabel("Locate the folder for alpha-shelf");
    await pickFolder("Locate the folder for alpha-shelf", MOVED);
    await opened("alpha-shelf", ALPHA_TITLES);
    check((await libraryState()).library_path === MOVED, "not relocated");
    check((await cardProgress(QUILL)) === "100", "progress lost after relocation");
    check(sidecar(MOVED, QUILL_REL).highlights.some((h) => h.text === "Alpha-only highlight"), "highlight lost");
    check(settings().libraries.find((l) => l.id === alphaId).path === MOVED, "relocation not saved");
    return { path: MOVED };
  });

  await step("C4 unreadable folder: shown as such, refused, recovers after access returns", async () => {
    mkdirSync(LOCKED);
    cpSync(path.join(MOVED, "basalt-ledger-handbook.pdf"), path.join(LOCKED, "locked-ledger.pdf"));
    await openDialog();
    await pastePath(LOCKED);
    await opened("locked-shelf", ["locked ledger"]);
    await openDialog();
    await clickLabel("Open alpha-shelf");
    await opened("alpha-shelf", ALPHA_TITLES);
    const lockedId = settings().libraries.find((l) => l.path === LOCKED).id;
    chmodSync(LOCKED, 0o000);
    try {
      await closeDialog();
      await openDialog(); // opening the dialog checks every folder again
      const row = await waitFor("locked row state", async () => {
        const found = (await rows()).find((r) => r.id === lockedId);
        return found?.state === "Folder can't be read" ? found : null;
      }, RESPONSIVE_MS);
      check(row.state === "Folder can't be read" && /cannot be read/.test(row.problem), `locked row ${JSON.stringify(row)}`);
      check(!row.buttons.includes("Open"), "unreadable library offered Open");
      const refused = await expectRefused(rawInvoke("switch_library", { id: lockedId }), /cannot be read/, "switch to an unreadable folder");
      check((await switcherName()) === "alpha-shelf", "open library changed");
      await shot("08-unreadable-folder");
      chmodSync(LOCKED, 0o755);
      await clickLabel("Check locked-shelf again");
      await waitFor("locked row available", async () => (await rows()).find((r) => r.id === lockedId)?.state === "Available", RESPONSIVE_MS);
      await clickLabel("Open locked-shelf");
      await opened("locked-shelf", ["locked ledger"]);
      return { row, refused };
    } finally {
      chmodSync(LOCKED, 0o755);
    }
  });

  await step("C4 unwritable library list: rename fails visibly and nothing changes", async () => {
    await openDialog();
    await clickLabel("Open alpha-shelf");
    await opened("alpha-shelf", ALPHA_TITLES);
    const before = readFileSync(settingsFile());
    chmodSync(appDir, 0o555);
    try {
      await openDialog();
      await clickLabel("Rename alpha-shelf");
      await present(".library-rename input");
      await setInput(".library-rename input", "Should not stick");
      await click('.library-rename button[type="submit"]');
      const error = await waitFor("save error", () => text(".launcher-error"), RESPONSIVE_MS);
      check(/cannot save the library list/.test(error), `error ${error}`);
      check(Buffer.compare(before, readFileSync(settingsFile())) === 0, "settings changed");
      await shot("09-unwritable-settings");
      await browser.keys(["Escape"]);
      const list = await invoke("list_libraries");
      check(list.libraries.find((l) => l.id === alphaId).name === "alpha-shelf", "in-memory list changed");
      return { error };
    } finally {
      chmodSync(appDir, 0o755);
      await closeDialog().catch(() => {});
    }
  });

  await step("close app (session 3)", closeApp);

  // ---- Session 4: corrupt index, corrupt list --------------------------------
  await step("C4 corrupt index is set aside and rebuilt from the folder", async () => {
    const file = indexFile(alphaId);
    for (const side of ["-wal", "-shm"]) rmSync(`${file}${side}`, { force: true });
    writeFileSync(file, "not an index, synthetic corruption\n");
    await launchApp();
    await opened("alpha-shelf", ALPHA_TITLES);
    const notice = await waitFor("index notice", () => text(".launcher-notice"), 15000);
    check(/search index for “alpha-shelf” could not be read/.test(notice), `notice ${notice}`);
    const kept = readdirSync(path.dirname(file)).filter((f) => f.startsWith("library.db.unreadable-"));
    check(kept.length === 1 && readFileSync(path.join(path.dirname(file), kept[0]), "utf8") === "not an index, synthetic corruption\n", `kept ${kept}`);
    check((await cardProgress(QUILL)) === "100", "progress lost with the index");
    await shot("10-corrupt-index-notice");
    return { notice, kept };
  });

  await step("close app (session 4)", closeApp);

  await step("C4 corrupt library list restores the previous saved list, visibly", async () => {
    const backup = JSON.parse(readFileSync(path.join(appDir, "settings.previous.json"), "utf8"));
    writeFileSync(settingsFile(), "{ synthetic corruption");
    await launchApp();
    const notice = await waitFor("list notice", () => text(".launcher-notice"), 30000);
    check(/library list could not be read/.test(notice) && /previous saved list was restored/.test(notice), `notice ${notice}`);
    const kept = readdirSync(appDir).filter((f) => f.startsWith("settings.json.unreadable-"));
    check(kept.length === 1 && readFileSync(path.join(appDir, kept[0]), "utf8") === "{ synthetic corruption", `kept ${kept}`);
    const list = await invoke("list_libraries");
    check(list.libraries.length === backup.libraries.filter((l) => !l.removed_at).length, "restored list differs from the backup");
    await shot("11-corrupt-list-restored");
    return { notice, restored: list.libraries.map((l) => l.name) };
  });

  await step("close app (session 5)", closeApp);

  await step("C4 corrupt list without a backup: empty, explained, folders untouched", async () => {
    const before = digest(MOVED);
    rmSync(path.join(appDir, "settings.previous.json"));
    writeFileSync(settingsFile(), "\u0000garbage");
    await launchApp();
    const notice = await waitFor("list notice", () => text(".launcher-notice"), 30000);
    check(/Open your library folders again/.test(notice), `notice ${notice}`);
    check((await rows()).length === 0, "libraries listed from an unreadable list");
    check(!(await exists(".grid")), "a library opened");
    check(JSON.stringify(digest(MOVED)) === JSON.stringify(before), "library folder changed");
    await pastePath(MOVED);
    await opened("alpha-shelf-moved", ALPHA_TITLES);
    check((await cardProgress(QUILL)) === "100", "reading progress lost");
    return { notice };
  });

  await step("C4 renderer paths and ids outside the open library are refused", async () => {
    writeFileSync(path.join(OUTSIDE, "profile.md"), "---\ntitle: Outside\nstatus: wishlist\n---\n\nbody\n");
    const outsideBefore = digest(OUTSIDE);
    const refusals = {
      sidecar: await expectRefused(invoke("get_sidecar", { path: path.join(B, QUILL_REL) }), /outside the library/, "read another library's sidecar"),
      progress: await expectRefused(invoke("save_progress", { path: path.join(OUTSIDE, "x.pdf"), position: "1", percent: 0 }), /outside the library/, "write outside"),
      catalog: await expectRefused(invoke("set_catalog_status", { path: path.join(OUTSIDE, "profile.md"), status: "queued" }), /outside the library/, "catalog status outside"),
      unknown: await expectRefused(rawInvoke("list_books", { libraryId: "00000000-0000-4000-8000-000000000000", query: null }), /no longer in your list/, "unknown library id"),
      switchUnknown: await expectRefused(rawInvoke("switch_library", { id: "00000000-0000-4000-8000-000000000000" }), /no longer in your list/, "switch to unknown"),
      nested: await expectRefused(rawInvoke("add_library", { path: path.join(MOVED, "inner") }), /was not found|inside the library/, "nested or missing folder"),
      stateFolder: await expectRefused(rawInvoke("add_library", { path: path.join(B, ".properbooky") }), /own data folder/, "a library's state folder"),
    };
    mkdirSync(path.join(MOVED, "inner"));
    refusals.nestedExisting = await expectRefused(rawInvoke("add_library", { path: path.join(MOVED, "inner") }), /inside the library/, "nested library");
    rmSync(path.join(MOVED, "inner"), { recursive: true });
    check(JSON.stringify(digest(OUTSIDE)) === JSON.stringify(outsideBefore) && !existsSync(path.join(OUTSIDE, ".properbooky")), "outside folder changed");
    return refusals;
  });

  await step("close app (session 6)", closeApp);

  await step("app-data holds only the library list and per-library indexes", () => {
    // WebKit keeps its own webview storage here too; ProperBooky's files are
    // the library list and the indexes.
    const webkit = /^(CacheStorage|WebKitCache|mediakeys|storage|databases|localstorage)\/|^hsts-storage\.sqlite/;
    const files = listTree(appDir).map((f) => f.path).filter((f) => !webkit.test(f));
    const unexpected = files.filter(
      (f) =>
        !/^settings(\.previous)?\.json$/.test(f) &&
        !/^settings\.json\.unreadable-\d+(-\d+)?$/.test(f) &&
        !/^libraries\/[0-9a-f-]{36}\/library\.db(-wal|-shm|\.unreadable-\d+(-\d+)?)?$/.test(f),
    );
    check(!unexpected.length, `unexpected app-data files ${JSON.stringify(unexpected)}`);
    const list = readFileSync(settingsFile(), "utf8");
    check(!/position|highlight|percent/.test(list), "reading state in the library list");
    return { files };
  });

  stopWatchdog();
  server.close();
  await finish(0, "pass");
} catch (e) {
  log("error:", String(e?.stack ?? e));
  stopWatchdog();
  server.close();
  try {
    if (LOCKED && existsSync(LOCKED)) chmodSync(LOCKED, 0o755);
    if (appDir && existsSync(appDir)) chmodSync(appDir, 0o755);
  } catch {}
  await finish(1, "fail");
}
