// Desktop E2E smoke: boots the real app via tauri-driver (WebKitWebDriver)
// and walks the core flow — library renders, search works, a book opens,
// pages turn, and the UI stays responsive (regression net for the
// reload-loop freeze).
//
// Usage: npm run test:e2e:desktop
// Requires: webkit2gtk-driver installed, tauri-driver in ~/.cargo/bin,
// the debug binary built, and (for the dev binary) `npm run dev` serving
// port 1420 — `tauri dev` leaves both in place.

import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { remote } from "webdriverio";

const here = path.dirname(fileURLToPath(import.meta.url));
const application = path.resolve(here, "../src-tauri/target/debug/desktop");
const tauriDriver = path.join(os.homedir(), ".cargo", "bin", "tauri-driver");

const driver = spawn(tauriDriver, [], { stdio: ["ignore", "inherit", "inherit"] });
await wait(1500);

let failed = false;
let browser;
try {
  browser = await remote({
    hostname: "127.0.0.1",
    port: 4444,
    logLevel: "warn",
    capabilities: {
      alwaysMatch: {
        "tauri:options": { application },
      },
    },
  });

  // 1. App boots: tab rail + Library tab exist.
  await browser.$(".tab-rail").waitForExist({ timeout: 20000 });
  assert.ok(await browser.$(".tab-library").isExisting(), "Library tab missing");

  // 2. Library renders. Prefer waiting for cards — the empty-state text
  // also shows transiently while books load, so it can't be the first check.
  await browser
    .waitUntil(async () => (await browser.$$(".card")).length > 0, {
      timeout: 25000,
    })
    .catch(async () => {
      const empty = await browser.$(".empty");
      if (!(await empty.isExisting())) {
        throw new Error("neither grid nor empty state rendered");
      }
    });

  const cards = await browser.$$(".card");
  console.log(`library rendered with ${cards.length} cards`);

  if (cards.length > 0) {
    // 3. Search narrows the grid and stays responsive. WebKitWebDriver is
    // picky about key input, so drive the controlled input natively.
    const type = (value) =>
      browser.execute((v) => {
        const el = document.querySelector('.toolbar input[type="search"]');
        const set = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;
        set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    await type("the");
    await wait(600);
    assert.ok(
      (await browser.$$(".card")).length > 0,
      "search returned nothing for a common token"
    );
    await type("");
    await wait(600);

    // 4. Open the first openable book; the reader must appear.
    const openable = await browser.$$(".card-openable");
    if (openable.length > 0) {
      await openable[0].click();
      await browser.$(".reader").waitForExist({ timeout: 45000 });
      console.log("reader opened");

      // 5. Regression net for the freeze: after opening, the UI must
      //    still respond — turn a page, then click back to Library.
      const buttons = await browser.$$(".reader-bar button");
      await buttons[buttons.length - 1].click();
      await wait(400);
      await browser.$(".tab-library").click();
      await browser
        .$('.toolbar input[type="search"]')
        .waitForExist({ timeout: 8000 });
      console.log("UI responsive after opening a book");

      // 6. Close the book tab.
      const close = await browser.$(".tab-close");
      if (await close.isExisting()) await close.click();
    } else {
      console.log("no openable cards; skipped reader steps");
    }
  }

  console.log("DESKTOP E2E: PASS");
} catch (e) {
  failed = true;
  console.error("DESKTOP E2E: FAIL —", e.message ?? e);
} finally {
  if (browser) await browser.deleteSession().catch(() => {});
  driver.kill();
}
process.exit(failed ? 1 : 0);
