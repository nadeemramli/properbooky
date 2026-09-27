// Real Tauri/WebKit test with an isolated library and isolated app data.
// Build the frontend and Rust binary + seed_index example first. Serve dist on
// localhost:1420; run via xvfb-run on Linux. TAURI_BINARY can override the binary.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const application =
  process.env.TAURI_BINARY ??
  path.resolve(here, "../src-tauri/target/debug/desktop");
const temp = mkdtempSync(path.join(os.tmpdir(), "properbooky-review-"));
const library = path.join(temp, "library");
for (const folder of ["Catalog", "Library", "Articles"])
  mkdirSync(path.join(library, folder), { recursive: true });
const source =
  "---\ntitle: 0071713166.pdf\nauthor: Test Author\nstatus: reading\nyear: 2014\ntopics: [Self-Help]\nfile: Library/book.pdf\n---\n\nKeep my context.\n";
writeFileSync(path.join(library, "Catalog/original.md"), source);
writeFileSync(
  path.join(library, "Catalog/duplicate.md"),
  "---\ntitle: Other edition\nauthor: Test  Author\nstatus: wishlist\nfile: Library/book.pdf\ntopics: [Self-help]\nyear: 2017\n---\n",
);
writeFileSync(
  path.join(library, "Catalog/wanted.md"),
  "---\ntitle: Future Book\nauthor: Another Author\nstatus: wishlist\n---\n",
);
writeFileSync(
  path.join(library, "Library/book.pdf"),
  "%PDF-fixture: metadata test only",
);
writeFileSync(
  path.join(library, "Articles/reading.md"),
  "---\ntitle: A reading article\nauthor: Test Author\nsource_url: https://example.com/article\n---\n\n# The article\n\nReading content that survives library corrections.\n",
);
const appData = path.join(temp, "data");
// Exercise the real lookup command offline through its normal persisted cache.
const metadataCache = path.join(library, ".properbooky/metadata-cache");
mkdirSync(metadataCache, { recursive: true });
writeFileSync(
  path.join(
    metadataCache,
    `${createHash("sha256").update("0071713166.pdf\nStandard Author").digest("hex")}.json`,
  ),
  JSON.stringify({
    fetched_at: Math.floor(Date.now() / 1000),
    stale: false,
    docs: [
      {
        key: "/works/OL1W",
        title: "Clean Book Title",
        author_name: ["Standard Author"],
        subject: ["Psychology"],
        first_publish_year: 1999,
        cover_i: null,
        isbn: [],
      },
    ],
  }),
);
execFileSync(path.join(path.dirname(application), "examples/seed_index"), [
  library,
  path.join(appData, "com.nadeemramli.properbooky/library.db"),
]);
const driver = spawn(path.join(os.homedir(), ".cargo/bin/tauri-driver"), [], {
  env: { ...process.env, XDG_DATA_HOME: appData },
  stdio: "inherit",
});
let browser;
try {
  await wait(1500);
  browser = await remote({
    hostname: "127.0.0.1",
    port: 4444,
    logLevel: "warn",
    connectionRetryTimeout: 30000,
    connectionRetryCount: 0,
    waitforTimeout: 10000,
    capabilities: { alwaysMatch: { "tauri:options": { application } } },
  });
  const count = async (n) =>
    browser.waitUntil(async () => (await browser.$$(".card")).length === n, {
      timeout: 20000,
    });
  const click = async (text) => {
    console.log(`UI: ${text}`);
    await browser.$(`button=${text}`).click();
  };
  const screenshot = async (name) => {
    if (process.env.PB_SCREENSHOTS !== "1") return;
    await browser.saveScreenshot(path.join(temp, name));
  };
  const type = async (selector, value) => {
    await browser.execute(
      (selector, value) => {
        const el = document.querySelector(selector);
        Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value",
        ).set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      selector,
      value,
    );
    await wait(350);
  };
  // WebKit's native option clicking can return without firing change after
  // closing a modal. Set the DOM control and dispatch its normal change event.
  const select = async (selector, value) => {
    await browser.execute(
      (selector, value) => {
        const el = document.querySelector(selector);
        if (![...el.options].some((option) => option.value === value))
          throw new Error(`Missing option: ${value}`);
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        ).set.call(el, value);
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      selector,
      value,
    );
  };
  await count(4); // Linked raw file is hidden, duplicate profiles remain reviewable.
  await click("On the shelf");
  await count(3);
  await click("Continue reading");
  await count(1);
  assert.match(await browser.$(".book-state").getText(), /PDF · reading/i);
  assert.match(await browser.$(".badge").getText(), /on the shelf/i);
  await click("Review details");
  await browser.$(".review-candidates article").waitForExist();
  assert.match(
    await browser.$(".review-candidates").getText(),
    /Other edition/,
  );
  await type(".review-fields input", "Corrected Title");
  await select(".review-fields select", "report");
  await click("Preview changes");
  assert.match(
    await browser.$(".book-review table").getText(),
    /0071713166.pdf/,
  );
  assert.match(
    await browser.$(".book-review table").getText(),
    /Corrected Title/,
  );
  await screenshot("review-preview.png");
  await click("Save changes");
  await browser.$(".book-review").waitForExist({ reverse: true });
  await click("Documents");
  await count(1);
  assert.equal(await browser.$(".card h2").getText(), "Corrected Title");
  await click("Rescan");
  await browser.waitUntil(async () =>
    (await browser.$(".status").getText()).startsWith("Indexed"),
  );
  await count(1);
  assert.equal(await browser.$(".card h2").getText(), "Corrected Title");
  await click("Everything");
  await type('.toolbar input[type="search"]', "0071713166");
  await count(1);
  assert.equal(await browser.$(".card h2").getText(), "Corrected Title");
  await type('.toolbar input[type="search"]', "");
  await click("Wishlist");
  await count(1);
  assert.equal(await browser.$(".card h2").getText(), "Future Book");
  await click("Library cleanup");
  await click("Undo last correction");
  await browser.waitUntil(async () =>
    (await browser.$(".status").getText()).includes("undone"),
  );
  await click("Continue reading");
  await count(1);
  assert.equal(await browser.$(".card h2").getText(), "0071713166.pdf");
  assert.equal(
    readFileSync(path.join(library, "Catalog/original.md"), "utf8"),
    source,
  );
  await click("Everything");
  await count(4);
  await select('select[aria-label="Filter by author"]', "test author");
  await count(3);
  await select('select[aria-label="Filter by topic"]', "self help");
  await count(2);
  await click("Clear browse filters");
  await click("Continue reading");
  await count(1);
  await click("Review details");
  await type(".candidate-search input", "Other edition");
  await click("Review combination");
  await browser.$(".merge-review").waitForExist();
  await click("Cancel");
  await browser.$("#review-title").waitForDisplayed();
  await click("Review combination");
  assert.match(await browser.$(".merge-notice").getText(), /years differ/);
  await browser.$(".source-profiles summary").click();
  await click("Read original notes and metadata");
  await browser.$(".source-profiles pre").waitForExist();
  assert.match(
    await browser.$(".source-profiles pre").getText(),
    /Keep my context/,
  );
  await click("Preview combination");
  assert.match(
    await browser.$(".merge-review").getText(),
    /2 source profiles and 1 linked file/,
  );
  await screenshot("merge-preview.png");
  await click("Combine profiles");
  await browser.$(".merge-review").waitForExist({ reverse: true });
  await click("Everything");
  await count(3);
  await type('.toolbar input[type="search"]', "Other edition");
  await count(1);
  assert.equal(await browser.$(".card h2").getText(), "0071713166.pdf");
  assert.match(await browser.$(".card").getText(), /2 source profiles/);
  // A later download attached to a retained source joins the same visible work.
  writeFileSync(
    path.join(library, "Library/edition.epub"),
    "epub metadata fixture",
  );
  const duplicate = path.join(library, "Catalog/duplicate.md");
  writeFileSync(
    duplicate,
    readFileSync(duplicate, "utf8").replace(
      "Library/book.pdf",
      "Library/edition.epub",
    ),
  );
  await click("Rescan");
  await browser.waitUntil(
    async () => (await browser.$$(".read-book")).length === 2,
  );
  assert.match(await browser.$(".card").getText(), /PDF \/ EPUB|EPUB \/ PDF/);
  await type('.toolbar input[type="search"]', "");
  await click("Library cleanup");
  await click("Undo last correction");
  await browser.waitUntil(async () =>
    (await browser.$(".status").getText()).includes("undone"),
  );
  await click("Everything");
  await count(4);
  assert.equal(
    readFileSync(path.join(library, "Catalog/original.md"), "utf8"),
    source,
  );
  // Shared labels, ordered roadmaps and reviewed enrichment use real Tauri IPC.
  await click("Organize library");
  await browser
    .$('.organize-library input[list="existing-labels"]')
    .waitForExist();
  await type('.organize-library input[list="existing-labels"]', "Test Author");
  await type(
    ".organize-library .review-fields label:nth-child(3) input",
    "Standard Author",
  );
  await click("Add label rule");
  await select(".organize-library .review-fields select", "topics");
  await type('.organize-library input[list="existing-labels"]', "Self-help");
  await type(
    ".organize-library .review-fields label:nth-child(3) input",
    "Personal Growth",
  );
  await click("Add label rule");
  await click("Reading roadmaps");
  await click("New roadmap");
  await type(
    ".organize-library .review-fields input",
    "Psychology foundations",
  );
  await click("Add: 0071713166.pdf");
  await click("Add: Other edition");
  await click("Add: Future Book");
  await type(".roadmap-steps textarea", "Start with the foundations");
  await browser.$('button[aria-label="Move earlier: Future Book"]').click();
  assert.deepEqual(
    await browser.$$(".roadmap-steps strong").map((el) => el.getText()),
    ["0071713166.pdf", "Future Book", "Other edition"],
  );
  await click("Preview organization");
  assert.match(
    await browser.$(".organize-library").getText(),
    /3 profiles will display updated/,
  );
  await screenshot("organization-preview.png");
  await click("Save organization");
  await browser.$(".organize-library").waitForExist({ reverse: true });
  await click("Everything");
  await select('select[aria-label="Filter by author"]', "standard author");
  await count(3);
  await select('select[aria-label="Filter by topic"]', "personal growth");
  await count(2);
  await click("Clear browse filters");
  await click("Continue reading");
  await count(1);
  await click("Review details");
  await type(".candidate-search input", "Other edition");
  await click("Review combination");
  await click("Preview combination");
  await click("Combine profiles");
  await browser.$(".merge-review").waitForExist({ reverse: true });
  await click("Organize library");
  await click("Reading roadmaps");
  await browser.waitUntil(
    async () => (await browser.$$(".roadmap-steps > li")).length === 2,
  );
  assert.match(
    await browser.$(".roadmap-steps").getText(),
    /Start with the foundations/,
  );
  await screenshot("roadmap.png");
  await click("Close");
  await click("Library cleanup");
  await click("Undo last correction");
  await click("Continue reading");
  await count(1);
  await click("Review details");
  await click("Look up metadata");
  await browser.$(".metadata-results article").waitForExist();
  await click("Choose this result");
  await click("Use selected fields");
  await click("Preview changes");
  assert.match(
    await browser.$(".book-review").getText(),
    /Edition year and ISBN stay unchanged/,
  );
  await click("Save changes");
  await browser.$(".book-review").waitForExist({ reverse: true });
  assert.equal(await browser.$(".card h2").getText(), "Clean Book Title");
  await click("Rescan");
  await browser.waitUntil(async () =>
    (await browser.$(".status").getText()).startsWith("Indexed"),
  );
  assert.match(await browser.$(".card .meta").getText(), /2014/);
  await click("Organize library");
  await click("Reading roadmaps");
  await browser.waitUntil(
    async () => (await browser.$$(".roadmap-steps > li")).length === 3,
  );
  assert.equal(
    await browser.$(".roadmap-steps strong").getText(),
    "Clean Book Title",
  );
  await click("Close");
  await click("Library cleanup");
  await click("Undo last correction");
  await click("Continue reading");
  await count(1);
  assert.equal(await browser.$(".card h2").getText(), "0071713166.pdf");
  assert.equal(
    readFileSync(path.join(library, "Catalog/original.md"), "utf8"),
    source,
  );
  await click("Everything");
  await type('.toolbar input[type="search"]', "A reading article");
  await count(1);
  await click("Read");
  await browser.$(".reader").waitForExist({ timeout: 15000 });
  await browser.$(".tab-library").click();
  await browser.$('.toolbar input[type="search"]').waitForExist();
  await screenshot("library.png");
  console.log(`LIBRARY REVIEW E2E: PASS; artifacts: ${temp}`);
} catch (error) {
  if (browser) {
    await browser
      .saveScreenshot(path.join(temp, "failure.png"))
      .catch(() => {});
    console.error((await browser.$("body").getText()).slice(0, 6000));
  }
  console.error(`Artifacts: ${temp}`);
  throw error;
} finally {
  if (browser) await browser.deleteSession().catch(() => {});
  driver.kill();
}
