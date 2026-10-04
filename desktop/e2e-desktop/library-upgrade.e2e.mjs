// PBK-15 upgrade rehearsal, packaged: an install from before multiple
// libraries (one library_path in app-data library.db) is upgraded on a COPY
// of its app-data by the new build, then (when the previous build is
// available) rolled back by running the previous build on the upgraded copy.
// Synthetic fixtures and temp app-data only; no owner data.
//
// Legacy app-data comes from one of:
//   E2E_BASE_APP=/path/to/previous/desktop  the previous release, driven
//       through its own first-run form, reader and Obsidian panel (local
//       rehearsal; also runs the rollback phase)
//   E2E_SEED_INDEX=/path/to/seed_index      the repository's legacy seeder
//       (examples/seed_index.rs: db::open + library_path), plus a sidecar
//       written in the on-disk format (CI; no rollback phase)
//
// PBK-26 review repair: the previous build's Obsidian notes (written before
// highlight block markers) are edited by the user with quotes, **Note:**
// lines, headings, blank lines and CRLF lines; the new build migrates the one
// whose generated text it can prove, refuses the ambiguous one without
// writing it, migrates it once the user moves their text, and nothing is
// rewritten again across repeated syncs, restarts and library switches.
//
// Usage (Linux, inside an X server or `xvfb-run -a`):
//   E2E_APP=/path/to/desktop E2E_BASE_APP=… node e2e-desktop/library-upgrade.e2e.mjs

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
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

const BASE_APP = process.env.E2E_BASE_APP ? path.resolve(process.env.E2E_BASE_APP) : null;
const SEED_INDEX = process.env.E2E_SEED_INDEX ? path.resolve(process.env.E2E_SEED_INDEX) : null;
const QUILL = "quillfeather orbit atlas";
const QUILL_REL = "quillfeather-orbit-atlas.pdf";
const ZEPHYR = "Zephyr Lantern Field Notes";
const ZEPHYR_REL = "Zephyr Lantern Field Notes.epub";
const TITLES = ["Zephyr Lantern Field Notes", "basalt ledger handbook", QUILL].sort();
const APP_ID = "com.nadeemramli.properbooky";
const shot = (name) => browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));

const click = (selector) =>
  browser.execute((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`no element ${s}`);
    el.click();
  }, selector);

async function clickText(label) {
  await waitFor(
    `enabled "${label}"`,
    () =>
      browser.execute((l) => {
        const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === l || b.getAttribute("aria-label") === l);
        if (!el || el.disabled) return false;
        el.click();
        return true;
      }, label),
    RESPONSIVE_MS,
  );
}

async function readCard(title) {
  await waitFor(
    `Read on "${title}"`,
    () =>
      browser.execute((t) => {
        const card = Array.from(document.querySelectorAll(".grid .card")).find((c) => c.querySelector("h2")?.textContent.trim() === t);
        const button = card?.querySelector(".read-book");
        if (!button) return false;
        button.click();
        return true;
      }, title),
    RESPONSIVE_MS,
  );
}

const PANEL = '.acquire-panel[aria-label="Obsidian sync"]';
/** Sync through the real Obsidian panel: type `vault`, or (`typed` false)
 * check it is the library's saved vault the panel shows. Returns the report
 * line, the "Not exported" reasons and any error shown. */
async function syncPanel(vault, typed = false, screenshot = null) {
  await click("#tab-library");
  await clickText("Obsidian");
  await waitFor("Obsidian panel", () => browser.execute((p) => Boolean(document.querySelector(`${p} .path-form input`)), PANEL), RESPONSIVE_MS);
  if (typed) await setInput(`${PANEL} .path-form input`, vault);
  await waitFor(typed ? "vault path kept" : "vault carried into the panel", () => browser.execute((p, v) => document.querySelector(`${p} .path-form input`)?.value === v, PANEL, vault), RESPONSIVE_MS);
  await clickText("Sync highlights now");
  const outcome = await waitFor(
    "export outcome",
    () =>
      browser.execute((p) => {
        const report = document.querySelector(`${p} .acquire-report`)?.textContent.trim() || null;
        const status = document.querySelector(`${p} p.status`)?.textContent.trim() || null;
        const skipped = Array.from(document.querySelectorAll(`${p} ul[aria-label="Not exported"] li`)).map((li) => li.textContent.trim());
        return report || status ? { report, status, skipped } : null;
      }, PANEL),
    15000,
  );
  if (screenshot) {
    await new Promise((r) => setTimeout(r, 400)); // let WebKit paint the outcome
    await shot(screenshot);
  }
  await clickText("Close");
  await waitFor("Obsidian panel closed", () => browser.execute((p) => !document.querySelector(p), PANEL), RESPONSIVE_MS);
  return outcome;
}

const cardProgress = (title) =>
  browser.execute((t) => {
    const card = Array.from(document.querySelectorAll(".grid .card")).find((c) => c.querySelector("h2")?.textContent.trim() === t);
    return card?.querySelector('.card-progress[role="progressbar"]')?.getAttribute("aria-valuenow") ?? null;
  }, title);

function sidecar(root, relative = QUILL_REL) {
  const registry = JSON.parse(readFileSync(path.join(root, ".properbooky/identities.json"), "utf8"));
  const record = registry.records.findLast((r) => r.path === relative);
  const file = path.join(root, ".properbooky/state", record.state_file);
  return { file, value: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null };
}

/** Content of the legacy database (main file and WAL; -shm is SQLite's
 * transient index, which readers may refresh). */
function legacyDigest(appDir) {
  const out = {};
  for (const name of ["library.db", "library.db-wal"]) {
    const file = path.join(appDir, name);
    out[name] = existsSync(file) ? sha256(file) : null;
  }
  return out;
}

// ---- Obsidian notes from before highlight block markers (PBK-26 repair) -----

const BLOCK_START = "<!-- properbooky:highlights:start (regenerated on sync; write your own notes outside this block) -->";
const BLOCK_END = "<!-- properbooky:highlights:end -->";
const EPUB_ANCHOR = { type: "epub-cfi", cfi: "epubcfi(/6/4!/4/2/2,/1:0,/1:13)" };
// Zephyr: a multi-line note (blank line and a quote inside it) and a plain one.
const ZEPHYR_HIGHLIGHTS = [
  { id: "7a1b2c3d-0000-4a6b-8c7d-000000000001", text: "quiet weather", note: "first line\n\nsecond paragraph\n> quoted in my note", anchor: EPUB_ANCHOR },
  { id: "7a1b2c3d-0000-4a6b-8c7d-000000000002", text: "lantern light", note: null, anchor: EPUB_ANCHOR },
];
// What the user wrote under the previous build's PDF note: commentary,
// quotes, a **Note:** line, headings, blank lines, CRLF lines, no final newline.
const QUILL_TAIL =
  "My legacy thought: keep me.\n\n## My reading notes\n> USER QUOTE: the atlas skips page 3\n**Note:** USER NOTE: check the orbit table\n\n\n# Heading I wrote\r\nA line saved with CRLF\r\n\r\n- [ ] follow up\nlast line without newline";
// Written between the two Zephyr highlights: ownership cannot be proven.
const ZEPHYR_MINE = "My thought between the two highlights.\n> USER QUOTE between highlights\n**Note:** USER NOTE between highlights\n\n";

/** The previous exporter's note for an uncatalogued book, byte for byte as
 * main 44e96b6 export.rs wrote it (title = file stem, no author). Proven
 * identical to the previous build's own output in E2E_BASE_APP mode. */
function legacyNote(relative, highlights) {
  const title = path.basename(relative).replace(/\.[^.]+$/, "");
  for (const v of [title, relative]) check(/^[A-Za-z][A-Za-z0-9 ._-]*$/.test(v), `not a plain YAML scalar: ${v}`);
  const location = (a) => (Number.isInteger(a.page) ? `page ${a.page}` : a.type === "article" ? "article" : a.type === "epub-cfi" ? "epub location" : "unknown location");
  let doc = `---\ntitle: ${title}\nsource: ${relative}\ngenerated_by: properbooky\n---\n\n# ${title}\n\n## Highlights\n\n`;
  for (const h of highlights) {
    for (const line of h.text.split("\n")) doc += `> ${line}\n`;
    doc += `> — ${location(h.anchor)} ^pb-${h.id.slice(0, 8)}\n\n`;
    if (h.note != null) doc += `**Note:** ${h.note}\n\n`;
  }
  return { name: `${title}.md`, text: doc };
}

const afterBlock = (text) => {
  const end = text.indexOf(BLOCK_END);
  check(end >= 0 && text.indexOf(BLOCK_START) >= 0 && text.indexOf(BLOCK_START) < end, "note has no highlights block");
  return text.slice(end + BLOCK_END.length);
};
const count = (text, part) => text.split(part).length - 1;
const fileState = (file) => ({ sha256: sha256(file), mtime: statSync(file).mtimeMs });

function digest(dir) {
  return listTree(dir)
    .map((f) => `${f.path}:${sha256(path.join(dir, f.path))}`)
    .sort();
}

startWatchdog(420000);
try {
  await step("binaries and legacy source present", () => {
    check(existsSync(APP), `binary not found: ${APP}`);
    check(BASE_APP || SEED_INDEX, "set E2E_BASE_APP (previous build) or E2E_SEED_INDEX (legacy seeder)");
    if (BASE_APP) check(existsSync(BASE_APP), `previous build not found: ${BASE_APP}`);
    if (SEED_INDEX) check(existsSync(SEED_INDEX), `seeder not found: ${SEED_INDEX}`);
    report.app = { path: APP, sha256: sha256(APP), bytes: statSync(APP).size };
    report.base_app = BASE_APP ? { path: BASE_APP, sha256: sha256(BASE_APP) } : null;
    report.legacy_source = BASE_APP ? "previous build through its UI" : "examples/seed_index (db::open + library_path)";
    return { app: report.app.sha256, base: report.base_app?.sha256 ?? null, source: report.legacy_source };
  });

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `${RUN_ID}-`));
  setTempRoot(tempRoot);
  // The app always uses data/ ; phases swap directories while it is closed.
  const dataDir = path.join(tempRoot, "data");
  const appDir = path.join(dataDir, APP_ID);
  const original = path.join(tempRoot, "data-original-legacy");
  const lib = path.join(tempRoot, "single-library");
  const vault = path.join(tempRoot, "vault");
  await step("fresh temp app-data, library copy and vault", () => {
    for (const d of ["data", "config", "cache", "state"]) mkdirSync(path.join(tempRoot, d));
    cpSync(fixturesDir, lib, { recursive: true });
    mkdirSync(vault);
    return { root: tempRoot };
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

  // ---- Legacy single-library install -----------------------------------------
  if (BASE_APP) {
    await step("previous build: index the library, read to page 2, set the Obsidian vault", async () => {
      await launchApp(BASE_APP);
      await waitFor("first-run form", () => browser.execute(() => Boolean(document.querySelector(".path-form input"))), 30000);
      await setInput(".path-form input", lib);
      await clickText("Index this path");
      await waitTitles(TITLES, 30000);
      await readCard(QUILL);
      check((await pdfPage()) === "1", "previous build opened the PDF elsewhere");
      await click('.reader-bar button[aria-label="Next page"]');
      await waitFor("page 2 saved", async () => sidecar(lib).value?.position === "2", 10000);
      const books = await rawInvoke("list_books", { query: QUILL });
      await rawInvoke("add_highlight", {
        path: books[0].path,
        text: "Legacy highlight",
        note: null,
        color: null,
        anchor: { type: "pdf", page: 2, quote: { exact: "Quillfeather Orbit Atlas - page 2", prefix: "", suffix: "" } },
      });
      const zephyrBooks = await rawInvoke("list_books", { query: "Zephyr" });
      check(zephyrBooks.length === 1, `Zephyr in previous build: ${zephyrBooks.length}`);
      for (const h of ZEPHYR_HIGHLIGHTS) {
        const added = await rawInvoke("add_highlight", { path: zephyrBooks[0].path, text: h.text, note: h.note, color: null, anchor: h.anchor });
        h.id = added.id; // the previous build chose the id
        await new Promise((r) => setTimeout(r, 20));
      }
      await click("#tab-library");
      await waitTitles(TITLES);
      await clickText("Obsidian");
      // The previous build's panel can overwrite a typed path when its own
      // settings load resolves late (fixed in PBK-15); type until it sticks.
      const input = '.acquire-panel[aria-label="Obsidian sync"] .path-form input';
      await waitFor(
        "vault path kept",
        async () => {
          await setInput(input, vault);
          await new Promise((r) => setTimeout(r, 300));
          return browser.execute((s, v) => document.querySelector(s)?.value === v, input, vault);
        },
        RESPONSIVE_MS,
      );
      await clickText("Sync highlights now");
      await waitFor("legacy export", () => browser.execute(() => document.querySelector(".acquire-report")?.textContent ?? null), 15000);
      const state = await rawInvoke("get_library_state");
      check(state.library_path === lib && !("library_id" in state), `not a single-library build: ${JSON.stringify(state)}`);
      await shot("01-previous-build");
      await closeApp();
      return { state, notes: readdirSync(path.join(vault, "Properbooky")) };
    });
  } else {
    await step("legacy seeder: library_path index plus an on-disk sidecar", () => {
      mkdirSync(appDir, { recursive: true });
      const out = execFileSync(SEED_INDEX, [lib, path.join(appDir, "library.db")], { encoding: "utf8" }).trim();
      const { file } = sidecar(lib);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          position: "2",
          percent: 2 / 3,
          updated_at: 1,
          highlights: [
            {
              id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
              text: "Legacy highlight",
              anchor: { type: "pdf", page: 2 },
              created_at: 1,
              updated_at: 1,
              deleted: false,
            },
          ],
        }),
      );
      const zephyr = sidecar(lib, ZEPHYR_REL).file;
      writeFileSync(
        zephyr,
        JSON.stringify({
          position: null,
          percent: null,
          updated_at: 2,
          highlights: ZEPHYR_HIGHLIGHTS.map((h, i) => ({ ...h, created_at: 10 + i, updated_at: 10 + i, deleted: false })),
        }),
      );
      return { seeder: out, sidecars: [path.basename(file), path.basename(zephyr)] };
    });
    await step("legacy seeder: the previous build's Obsidian notes (pre-marker format)", () => {
      const out = path.join(vault, "Properbooky");
      mkdirSync(out);
      const quill = sidecar(lib).value.highlights;
      const notes = [legacyNote(QUILL_REL, quill), legacyNote(ZEPHYR_REL, ZEPHYR_HIGHLIGHTS)];
      for (const n of notes) writeFileSync(path.join(out, n.name), n.text);
      return { notes: notes.map((n) => n.name) };
    });
  }

  if (BASE_APP) {
    await step("previous build's notes are exactly the legacy format this journey seeds in CI", () => {
      const out = path.join(vault, "Properbooky");
      const quill = sidecar(lib).value.highlights.filter((h) => !h.deleted);
      const expected = [legacyNote(QUILL_REL, quill), legacyNote(ZEPHYR_REL, ZEPHYR_HIGHLIGHTS)];
      const names = readdirSync(out).filter((n) => n.endsWith(".md")).sort();
      check(JSON.stringify(names) === JSON.stringify(expected.map((n) => n.name).sort()), `previous build wrote ${JSON.stringify(names)}`);
      for (const n of expected) {
        const actual = readFileSync(path.join(out, n.name), "utf8");
        check(!actual.includes("properbooky:highlights:start"), "previous build already wrote block markers");
        check(actual === n.text, `legacy writer differs from the previous build for ${n.name}:\n${JSON.stringify(actual)}\n${JSON.stringify(n.text)}`);
      }
      return { identical: expected.map((n) => n.name) };
    });
  }

  const legacyOut = path.join(vault, "Properbooky");
  const QUILL_NOTE = legacyNote(QUILL_REL, []).name;
  const ZEPHYR_NOTE = legacyNote(ZEPHYR_REL, []).name;
  let zephyrLegacy;
  let zephyrRefused;
  await step("user edits the previous build's notes in Obsidian (quotes, notes, headings, blank and CRLF lines)", () => {
    const quill = path.join(legacyOut, QUILL_NOTE);
    writeFileSync(quill, `${readFileSync(quill, "utf8")}${QUILL_TAIL}`);
    const zephyr = path.join(legacyOut, ZEPHYR_NOTE);
    zephyrLegacy = readFileSync(zephyr, "utf8");
    const second = `> lantern light\n> — epub location ^pb-${ZEPHYR_HIGHLIGHTS[1].id.slice(0, 8)}\n\n`;
    check(count(zephyrLegacy, second) === 1, "second Zephyr entry not found");
    writeFileSync(zephyr, zephyrLegacy.replace(second, `${ZEPHYR_MINE}${second}`));
    zephyrRefused = fileState(zephyr);
    return { quill: QUILL_NOTE, zephyr: ZEPHYR_NOTE, zephyr_sha256: zephyrRefused.sha256 };
  });

  let before;
  await step("upgrade rehearsal runs on a copy; the original is kept as the backup", () => {
    check(!existsSync(path.join(appDir, "settings.json")), "legacy app-data already has a library list");
    renameSync(dataDir, original);
    cpSync(original, dataDir, { recursive: true });
    before = { legacy: legacyDigest(appDir), original: digest(original), library: digest(lib) };
    report.legacy_before = before.legacy;
    return { legacy: before.legacy, original_files: before.original.length };
  });

  let libraryId;
  await step("new build on the copy: the library opens as before, with its reading state", async () => {
    await launchApp();
    await waitFor("library opened without the first-run form", () => browser.execute(() => document.querySelector(".library-switcher")?.childNodes[1]?.textContent.trim() ?? null), 30000).then((name) =>
      check(name === "single-library", `opened ${name}`),
    );
    await waitTitles(TITLES, 30000);
    const progress = await cardProgress(QUILL);
    check(progress === "67", `progress after upgrade ${progress}`);
    const state = await invoke("get_library_state");
    libraryId = state.library_id;
    check(state.library_path === lib && state.status === "available", `state ${JSON.stringify(state)}`);
    const saved = JSON.parse(readFileSync(path.join(appDir, "settings.json"), "utf8"));
    const entry = saved.libraries[0];
    check(saved.libraries.length === 1 && saved.active === entry.id && entry.migrated_from === "library.db" && entry.path === lib, `settings ${JSON.stringify(saved)}`);
    if (BASE_APP) {
      check(entry.obsidian_vault_path === vault, `vault not carried over: ${entry.obsidian_vault_path}`);
      const settings = await invoke("get_app_settings");
      check(settings.export_folder === path.join(vault, "Properbooky"), `export folder ${settings.export_folder}`);
    }
    await readCard(QUILL);
    check((await pdfPage()) === "2", "PDF not at its legacy position");
    const highlights = (await invoke("get_sidecar", { path: path.join(lib, QUILL_REL) })).highlights;
    check(highlights.some((h) => h.text === "Legacy highlight"), "legacy highlight lost");
    await click('.reader-bar button[aria-label="Next page"]');
    await waitFor("page 3 saved", async () => sidecar(lib).value?.position === "3", 10000);
    await shot("02-upgraded");
    // The migrated library takes over the folder the previous build wrote:
    // the current exporter keeps the user's text and claims the folder. The
    // PDF note's generated text is proven and migrated; the Zephyr note,
    // with text between its highlights, is refused and left unchanged.
    await click("#tab-library");
    await waitTitles(TITLES);
    const outcome = await syncPanel(vault, !BASE_APP, "02b-legacy-export-migrated-and-refused");
    const exported = outcome.report;
    check(/^Exported 1 highlights across 1 note \(1 updated\)/.test(exported ?? ""), `export after upgrade: ${JSON.stringify(outcome)}`);
    const out = path.join(vault, "Properbooky");
    const notes = readdirSync(out).filter((n) => n.endsWith(".md")).sort();
    check(JSON.stringify(notes) === JSON.stringify([QUILL_NOTE, ZEPHYR_NOTE].sort()), `notes after upgrade ${JSON.stringify(notes)}`);
    const text = readFileSync(path.join(out, QUILL_NOTE), "utf8");
    check(text.includes("Legacy highlight") && text.includes("properbooky:highlights:start") && text.includes("My legacy thought: keep me."), `legacy note after upgrade: ${text}`);
    check(afterBlock(text) === `\n\n${QUILL_TAIL}`, `user text not kept byte for byte: ${JSON.stringify(afterBlock(text))}`);
    check(count(text, "> Legacy highlight\n") === 1 && count(text, "## Highlights\n") === 1, "generated text duplicated or user heading lost");
    check(JSON.parse(readFileSync(path.join(out, ".properbooky-library"), "utf8")).library_id === libraryId, "export folder not claimed by the migrated library");
    check(outcome.skipped.length === 1 && outcome.skipped[0].startsWith(`${ZEPHYR_NOTE}: left unchanged: `) && outcome.skipped[0].includes("you wrote between its highlights") && outcome.skipped[0].includes("move your own text to the end of the note, below the last highlight"), `refusal shown ${JSON.stringify(outcome.skipped)}`);
    check(JSON.stringify(fileState(path.join(out, ZEPHYR_NOTE))) === JSON.stringify(zephyrRefused), "refused note was written");
    await closeApp();
    return { id: libraryId, progress, settings: saved, exported, refused: outcome.skipped };
  });

  await step("legacy database untouched by the upgrade; the original backup unchanged", () => {
    const after = legacyDigest(appDir);
    check(JSON.stringify(after) === JSON.stringify(before.legacy), `legacy database changed: ${JSON.stringify({ before: before.legacy, after })}`);
    check(JSON.stringify(digest(original)) === JSON.stringify(before.original), "original app-data changed");
    const files = listTree(appDir).map((f) => f.path);
    check(files.some((f) => /^libraries\/[0-9a-f-]{36}\/library\.db$/.test(f)), `no per-library index: ${files}`);
    return { legacy: after, files: files.filter((f) => !/^(CacheStorage|WebKitCache|mediakeys|storage|hsts)/.test(f)) };
  });

  if (BASE_APP) {
    await step("rollback: the previous build on the upgraded copy keeps every reading fact", async () => {
      await launchApp(BASE_APP);
      await waitTitles(TITLES, 30000);
      const state = await rawInvoke("get_library_state");
      check(state.library_path === lib, `previous build opened ${state.library_path}`);
      await readCard(QUILL);
      check((await pdfPage()) === "3", "rollback lost the position saved after the upgrade");
      await shot("03-rolled-back");
      await closeApp();
      return { state };
    });
  }

  await step("re-upgrade does not import again: same library, same id", async () => {
    await launchApp();
    await waitTitles(TITLES, 30000);
    const state = await invoke("get_library_state");
    check(state.library_id === libraryId, `library re-imported: ${state.library_id} vs ${libraryId}`);
    await readCard(QUILL);
    check((await pdfPage()) === "3", "position lost after re-upgrade");
    await closeApp();
    return { id: state.library_id };
  });

  const second = path.join(tempRoot, "second-library");
  const vaultTwo = path.join(tempRoot, "vault-two");
  let quillAfter;
  await step("after restart: repeated syncs rewrite nothing; the ambiguous note is still refused unchanged", async () => {
    await launchApp();
    await waitTitles(TITLES, 30000);
    const before = digest(legacyOut);
    quillAfter = readFileSync(path.join(legacyOut, QUILL_NOTE), "utf8");
    const runs = [];
    for (let i = 0; i < 2; i += 1) {
      const outcome = await syncPanel(vault);
      check(/^Exported 1 highlights across 1 note \(0 updated\)/.test(outcome.report ?? ""), `repeat ${i}: ${JSON.stringify(outcome)}`);
      check(outcome.skipped.length === 1 && outcome.skipped[0].startsWith(`${ZEPHYR_NOTE}: left unchanged: `), `repeat ${i} refusal ${JSON.stringify(outcome.skipped)}`);
      runs.push(outcome.report);
    }
    check(JSON.stringify(digest(legacyOut)) === JSON.stringify(before), "a repeated sync changed the export folder");
    check(JSON.stringify(fileState(path.join(legacyOut, ZEPHYR_NOTE))) === JSON.stringify(zephyrRefused), "refused note was written");
    return { runs };
  });

  await step("user moves their text below the last highlight: the next sync migrates it, keeping every byte", async () => {
    writeFileSync(path.join(legacyOut, ZEPHYR_NOTE), `${zephyrLegacy}${ZEPHYR_MINE}`);
    const outcome = await syncPanel(vault, false, "02c-moved-text-migrated");
    check(/^Exported 3 highlights across 2 notes \(1 updated\)/.test(outcome.report ?? "") && outcome.skipped.length === 0, `after the move ${JSON.stringify(outcome)}`);
    const text = readFileSync(path.join(legacyOut, ZEPHYR_NOTE), "utf8");
    check(afterBlock(text) === `\n\n${ZEPHYR_MINE}`, `moved text not kept byte for byte: ${JSON.stringify(afterBlock(text))}`);
    check(count(text, "> quiet weather\n") === 1 && count(text, "> lantern light\n") === 1, "Zephyr highlights duplicated or lost");
    check(count(text, "**Note:** first line\n\nsecond paragraph\n> quoted in my note\n") === 1, "multi-line note not regenerated once");
    check(readFileSync(path.join(legacyOut, QUILL_NOTE), "utf8") === quillAfter, "PDF note changed");
    const again = await syncPanel(vault);
    check(/\(0 updated\)/.test(again.report ?? "") && again.skipped.length === 0, `rerun ${JSON.stringify(again)}`);
    return { report: outcome.report, rerun: again.report };
  });

  await step("library switch: another library cannot write this folder; its own folder works; back again nothing changes", async () => {
    cpSync(fixturesDir, second, { recursive: true });
    mkdirSync(vaultTwo);
    const before = digest(legacyOut);
    if (!(await browser.execute(() => Boolean(document.querySelector(".libraries-dialog"))))) await click(".library-switcher");
    await waitFor("libraries dialog", () => browser.execute(() => Boolean(document.querySelector(".libraries-dialog"))), RESPONSIVE_MS);
    await setInput(".libraries-dialog .path-form input", second);
    await waitFor("enabled path button", () => browser.execute(() => document.querySelector('.libraries-dialog .path-form button[type="submit"]')?.disabled === false), RESPONSIVE_MS);
    await click('.libraries-dialog .path-form button[type="submit"]');
    await waitFor("second library open", () => browser.execute(() => document.querySelector(".library-switcher")?.childNodes[1]?.textContent.trim() === "second-library"), 30000);
    await waitTitles(TITLES, 30000);
    await invoke("add_highlight", { path: path.join(second, QUILL_REL), text: "Second-library highlight", note: null, color: null, anchor: { type: "pdf", page: 1 } });
    const refused = await syncPanel(vault, true, "02d-second-library-refused");
    check(!refused.report && /library “single-library”/.test(refused.status ?? ""), `second library into the first's folder ${JSON.stringify(refused)}`);
    check(JSON.stringify(digest(legacyOut)) === JSON.stringify(before), "second library changed the first library's notes");
    const own = await syncPanel(vaultTwo, true);
    check(/^Exported 1 highlights across 1 note/.test(own.report ?? ""), `second library export ${JSON.stringify(own)}`);
    check(JSON.stringify(digest(legacyOut)) === JSON.stringify(before), "second library changed the first library's notes");
    await click(".library-switcher");
    await waitFor("libraries dialog", () => browser.execute(() => Boolean(document.querySelector(".libraries-dialog"))), RESPONSIVE_MS);
    await clickText("Open single-library");
    await waitFor("first library open again", () => browser.execute(() => document.querySelector(".library-switcher")?.childNodes[1]?.textContent.trim() === "single-library"), 30000);
    await waitTitles(TITLES, 30000);
    const back = await syncPanel(vault);
    check(/^Exported 3 highlights across 2 notes \(0 updated\)/.test(back.report ?? "") && back.skipped.length === 0, `after switching back ${JSON.stringify(back)}`);
    check(JSON.stringify(digest(legacyOut)) === JSON.stringify(before), "switching libraries changed the notes");
    return { refused: refused.status, own: own.report, back: back.report };
  });

  await step("a new highlight after the migration updates only the block; restart keeps every byte", async () => {
    const zephyrBook = path.join(lib, ZEPHYR_REL);
    await invoke("add_highlight", { path: zephyrBook, text: "after the upgrade", note: "new note", color: null, anchor: EPUB_ANCHOR });
    const outcome = await syncPanel(vault);
    check(/^Exported 4 highlights across 2 notes \(1 updated\)/.test(outcome.report ?? ""), `after a new highlight ${JSON.stringify(outcome)}`);
    const zephyr = readFileSync(path.join(legacyOut, ZEPHYR_NOTE), "utf8");
    check(zephyr.indexOf("> after the upgrade\n") > zephyr.indexOf(BLOCK_START) && zephyr.indexOf("> after the upgrade\n") < zephyr.indexOf(BLOCK_END), "new highlight outside the block");
    check(afterBlock(zephyr) === `\n\n${ZEPHYR_MINE}`, "user text changed by a block update");
    check(readFileSync(path.join(legacyOut, QUILL_NOTE), "utf8") === quillAfter, "PDF note changed");
    const before = digest(legacyOut);
    await closeApp();
    await launchApp();
    await waitTitles(TITLES, 30000);
    const again = await syncPanel(vault, false, "02e-after-restart");
    check(/\(0 updated\)/.test(again.report ?? "") && again.skipped.length === 0, `after restart ${JSON.stringify(again)}`);
    check(JSON.stringify(digest(legacyOut)) === JSON.stringify(before), "restart and sync changed the notes");
    check(afterBlock(readFileSync(path.join(legacyOut, QUILL_NOTE), "utf8")) === `\n\n${QUILL_TAIL}`, "PDF note user text changed");
    await closeApp();
    return { report: outcome.report, after_restart: again.report };
  });

  stopWatchdog();
  await finish(0, "pass");
} catch (e) {
  log("error:", String(e?.stack ?? e));
  stopWatchdog();
  await finish(1, "fail");
}
