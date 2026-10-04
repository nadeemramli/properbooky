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

const cardProgress = (title) =>
  browser.execute((t) => {
    const card = Array.from(document.querySelectorAll(".grid .card")).find((c) => c.querySelector("h2")?.textContent.trim() === t);
    return card?.querySelector('.card-progress[role="progressbar"]')?.getAttribute("aria-valuenow") ?? null;
  }, title);

function sidecar(root) {
  const registry = JSON.parse(readFileSync(path.join(root, ".properbooky/identities.json"), "utf8"));
  const record = registry.records.findLast((r) => r.path === QUILL_REL);
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
      return { seeder: out, sidecar: path.basename(file) };
    });
  }

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
    await closeApp();
    return { id: libraryId, progress, settings: saved };
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

  stopWatchdog();
  await finish(0, "pass");
} catch (e) {
  log("error:", String(e?.stack ?? e));
  stopWatchdog();
  await finish(1, "fail");
}
