// PBK-15 search empty-state journey, packaged: drives the built ProperBooky
// binary (tauri-driver/WebKitWebDriver, harness.mjs) through the library
// search with temp copies of the committed synthetic fixtures and fresh
// app-data. A search with no match must say so for that query (not leave a
// blank grid); clearing or replacing the query recovers; a shelf filter that
// hides everything, an empty library folder, two libraries and a failed
// listing (unreadable folder) each show their own state. A DOM observer
// records every state change so no-results is never shown while loading or
// for a query other than the one it answers.
//
// Usage (Linux, inside an X server or `xvfb-run -a`; not as root unless DAC
// capabilities are dropped, e.g. capsh --drop=cap_dac_override,cap_dac_read_search):
//   E2E_APP=/path/to/desktop node e2e-desktop/search-states.e2e.mjs
// Environment as in harness.mjs; default whole-run watchdog 480000ms.

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APP,
  ARTIFACTS,
  RESPONSIVE_MS,
  RUN_ID,
  browser,
  check,
  finish,
  fixturesDir,
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

const ALPHA_TITLES = ["Zephyr Lantern Field Notes", "basalt ledger handbook", "quillfeather orbit atlas"];
const BETA_TITLES = ["cobalt signal primer", "quillfeather orbit atlas"];
const NO_MATCH = "zzqx";

let tempRoot = null;

const shot = (name) => browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));
const exists = (selector) => browser.execute((s) => Boolean(document.querySelector(s)), selector);
const present = (selector) => waitFor(`${selector} shown`, () => exists(selector), RESPONSIVE_MS);
const SEARCH = '.toolbar input[type="search"]';

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

/** What the library view shows right now. */
const view = () =>
  browser.execute((sel) => ({
    query: document.querySelector(sel)?.value ?? null,
    cards: Array.from(document.querySelectorAll(".grid .card h2")).map((h) => h.textContent.trim()).sort(),
    count: document.querySelector(".chip-count")?.textContent.trim() ?? null,
    noMatch: document.querySelector(".search-empty p")?.textContent.trim() ?? null,
    // Not named `error`: webdriverio reads { error } in a script result as a WebDriver error.
    failure: document.querySelector(".search-error")?.textContent.trim() ?? null,
    emptyLibrary: document.querySelector(".library-empty")?.textContent.trim() ?? null,
    filteredEmpty: document.querySelector(".grid .empty:not(.search-empty)")?.textContent.trim() ?? null,
    loading: Boolean(Array.from(document.querySelectorAll('[role="status"]')).find((e) => e.textContent.includes("Loading your library"))),
    library: document.querySelector(".library-switcher")?.childNodes[1]?.textContent.trim() ?? null,
  }), SEARCH);

/** Wait until the view settles into `want` (a predicate over view()). */
async function settled(what, want, timeout = 15000) {
  let last = null;
  try {
    return await waitFor(what, async () => {
      last = await view();
      return want(last) ? last : null;
    }, timeout);
  } catch {
    throw new Error(`${what}: view is ${JSON.stringify(last)}`);
  }
}

const noMatchFor = (q) => (v) =>
  v.query === q && v.cards.length === 0 && v.noMatch === `No books match “${q}”.` && !v.failure && !v.emptyLibrary && !v.loading;

/** Record every state change of the view (in the page) for later checks. */
const observe = () =>
  browser.execute((sel) => {
    window.__pbkStates = [];
    const record = () => {
      const loading = Boolean(Array.from(document.querySelectorAll('[role="status"]')).find((e) => e.textContent.includes("Loading your library")));
      window.__pbkStates.push({
        t: performance.now(),
        query: document.querySelector(sel)?.value ?? null,
        noMatch: document.querySelector(".search-empty p")?.textContent.trim() ?? null,
        failure: document.querySelector(".search-error")?.textContent.trim() ?? null,
        emptyLibrary: Boolean(document.querySelector(".library-empty")),
        loading,
        cards: document.querySelectorAll(".grid .card").length,
      });
    };
    window.__pbkObserver?.disconnect();
    window.__pbkObserver = new MutationObserver(record);
    window.__pbkObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    record();
  }, SEARCH);
const recorded = () => browser.execute(() => window.__pbkStates ?? []);

async function switchTo(name, titles) {
  await browser.execute(() => document.querySelector(".library-switcher")?.click());
  await present(".libraries-dialog");
  await clickLabel(`Open ${name}`);
  await waitFor(`library "${name}" open`, async () => (await view()).library === name, 30000);
  if (titles.length) await waitTitles(titles, 30000);
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

startWatchdog(480000);

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

  await step("fresh isolated app-data; alpha, beta and an empty library folder", () => {
    check(permissionsEnforced(), "folder permissions are not enforced for this process (root with DAC override); run as a non-root user or under capsh --drop=cap_dac_override,cap_dac_read_search");
    cpSync(fixturesDir, ALPHA, { recursive: true });
    mkdirSync(BETA);
    cpSync(path.join(fixturesDir, "quillfeather-orbit-atlas.pdf"), path.join(BETA, "quillfeather-orbit-atlas.pdf"));
    cpSync(path.join(fixturesDir, "basalt-ledger-handbook.pdf"), path.join(BETA, "cobalt-signal-primer.pdf"));
    mkdirSync(EMPTY);
    for (const d of ["data", "config", "cache", "state"]) mkdirSync(path.join(tempRoot, d));
    report.library_dirs = { ALPHA, BETA, EMPTY };
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
    return waitTitles(ALPHA_TITLES, 30000);
  });

  await step("R2 a search with no match says so for that query", async () => {
    await observe();
    await setInput(SEARCH, NO_MATCH);
    const v = await settled(`no-match message for "${NO_MATCH}"`, noMatchFor(NO_MATCH));
    check(v.count === "0 items", `count ${v.count}`);
    await shot("01-no-match");
    return v;
  });

  await step("R3 Clear search recovers the whole library; a valid search finds its book", async () => {
    await clickLabel("Clear search");
    const cleared = await settled("cleared search", (v) => v.query === "" && JSON.stringify(v.cards) === JSON.stringify(ALPHA_TITLES) && !v.noMatch);
    await setInput(SEARCH, "ledger");
    const found = await settled("search 'ledger'", (v) => v.query === "ledger" && JSON.stringify(v.cards) === JSON.stringify(["basalt ledger handbook"]) && !v.noMatch && !v.loading);
    return { cleared: cleared.cards.length, found: found.cards };
  });

  await step("R3 replacing a no-match query with a valid one, and emptying the field, recover", async () => {
    await setInput(SEARCH, NO_MATCH);
    await settled("no match again", noMatchFor(NO_MATCH));
    await setInput(SEARCH, "orbit");
    await settled("replaced by 'orbit'", (v) => v.query === "orbit" && JSON.stringify(v.cards) === JSON.stringify(["quillfeather orbit atlas"]) && !v.noMatch);
    await setInput(SEARCH, "nothing-like-this");
    await settled("no match for a second term", noMatchFor("nothing-like-this"));
    await setInput(SEARCH, "");
    const v = await settled("emptied field", (x) => x.query === "" && JSON.stringify(x.cards) === JSON.stringify(ALPHA_TITLES) && !x.noMatch && !x.emptyLibrary);
    return { cards: v.cards.length };
  });

  await step("R4 no-results was only ever shown for the query it answers, never while loading", async () => {
    const states = await recorded();
    const shown = states.filter((s) => s.noMatch);
    check(shown.length > 0, "the observer never saw a no-results message");
    const wrong = shown.filter((s) => s.loading || s.noMatch !== `No books match “${s.query}”.` || s.cards > 0 || s.failure);
    check(wrong.length === 0, `no-results shown out of place: ${JSON.stringify(wrong.slice(0, 5))}`);
    check(!states.some((s) => s.emptyLibrary), "the empty-library note appeared in a library with books");
    report.observed_states = states.length;
    return { states: states.length, no_match_states: shown.length };
  });

  await step("R5 a shelf filter that hides everything keeps its own message", async () => {
    await clickLabel("Finished");
    const v = await settled("Finished shelf empty", (x) => x.cards.length === 0 && x.filteredEmpty === "Nothing here." && !x.noMatch && !x.emptyLibrary);
    await setInput(SEARCH, "ledger");
    const q = await settled("filtered search", (x) => x.query === "ledger" && x.cards.length === 0 && x.filteredEmpty === "Nothing here for “ledger”." && !x.noMatch);
    await setInput(SEARCH, "");
    await clickLabel("Everything");
    await settled("all shelves again", (x) => x.query === "" && JSON.stringify(x.cards) === JSON.stringify(ALPHA_TITLES));
    return { filtered: v.filteredEmpty, with_query: q.filteredEmpty };
  });

  await step("R7 each library shows only its own results; a search does not follow a switch", async () => {
    await rawInvoke("add_library", { path: BETA });
    await rawInvoke("add_library", { path: EMPTY });
    await setInput(SEARCH, NO_MATCH);
    await settled("alpha no match", noMatchFor(NO_MATCH));
    await switchTo("beta-lib", BETA_TITLES);
    const fresh = await view();
    check(fresh.query === "" && !fresh.noMatch, `beta opened with alpha's search: ${JSON.stringify(fresh)}`);
    await setInput(SEARCH, "basalt");
    await settled("alpha's book is not found in beta", noMatchFor("basalt"));
    await setInput(SEARCH, "cobalt");
    await settled("beta's own book", (x) => x.query === "cobalt" && JSON.stringify(x.cards) === JSON.stringify(["cobalt signal primer"]) && !x.noMatch);
    await shot("02-beta-search");
    await switchTo("alpha-lib", ALPHA_TITLES);
    const back = await view();
    check(back.query === "" && !back.noMatch && JSON.stringify(back.cards) === JSON.stringify(ALPHA_TITLES), `alpha after switching back: ${JSON.stringify(back)}`);
    return { beta: BETA_TITLES, alpha: back.cards };
  });

  await step("R6 an empty library: its note, then a query's no-match, then the note again", async () => {
    await switchTo("empty-lib", []);
    const note = await settled("empty-library note", (x) => x.cards.length === 0 && x.emptyLibrary?.includes("No books were found") && !x.noMatch);
    await setInput(SEARCH, "anything");
    await settled("no match in the empty library", noMatchFor("anything"));
    await shot("03-empty-library-search");
    await clickLabel("Clear search");
    await settled("note again", (x) => x.query === "" && x.emptyLibrary?.includes("No books were found") && !x.noMatch);
    return { note: note.emptyLibrary.slice(0, 60) };
  });

  await step("R8 a failed search is reported as a failure, never as no results; access back recovers", async () => {
    await switchTo("alpha-lib", ALPHA_TITLES);
    await observe();
    chmodSync(ALPHA, 0o000);
    let failed;
    try {
      await setInput(SEARCH, "ledger");
      const t0 = Date.now();
      failed = await settled("search failure shown", (x) => x.query === "ledger" && x.failure && !x.noMatch && x.cards.length === 0 && !x.loading);
      failed.ms = Date.now() - t0;
      check(failed.failure.startsWith("Searching for “ledger” failed:") && failed.failure.includes("cannot be read"), `failure does not name the search and cause: ${failed.failure}`);
      await shot("04-failed-search");
    } finally {
      chmodSync(ALPHA, 0o755);
    }
    await setInput(SEARCH, "basalt");
    const recovered = await settled("search after access is back", (x) => x.query === "basalt" && JSON.stringify(x.cards) === JSON.stringify(["basalt ledger handbook"]) && !x.failure && !x.noMatch);
    const states = await recorded();
    check(!states.some((s) => s.noMatch), `a failed request was shown as no results: ${JSON.stringify(states.filter((s) => s.noMatch).slice(0, 3))}`);
    return { failure: failed.failure, ms: failed.ms, recovered: recovered.cards };
  });

  stopWatchdog();
  await finish(0, "pass");
} catch {
  stopWatchdog();
  await finish(1, "fail");
}
