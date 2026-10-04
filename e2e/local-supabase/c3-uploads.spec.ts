// PBK-30 criterion 3: manual upload, a mixed bulk queue with controlled
// failures, and a wishlist CSV import, each checked browser -> local Supabase
// (PostgREST + storage) -> reload.
import { test, expect, type Page } from "@playwright/test";

import {
  admin,
  bookRows,
  createConfirmedUser,
  fileSha256,
  fixturePath,
  loginThroughUi,
  recordForRestart,
  sha256,
  shot,
  supabaseIdle,
  trackSupabase,
  waitForCard,
} from "./support";

const EPUB = "Zephyr Lantern Field Notes.epub";
const PDF_OK = "basalt-ledger-handbook.pdf";
const PDF_FLAKY = "quillfeather-orbit-atlas.pdf";

let user: { id: string; email: string };

test.beforeAll(async () => {
  user = await createConfirmedUser("uploads");
});
test.beforeEach(({ page }) => trackSupabase(page));

async function openUploadDialog(page: Page, tab: "Manual Entry" | "CSV Import" | "Bulk Upload") {
  await page.getByRole("button", { name: "Upload Book" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: tab }).click();
  return dialog;
}

async function storedObjects(userId: string) {
  const { data, error } = await admin().storage.from("books").list(userId, { limit: 100 });
  if (error) throw error;
  return (data ?? []).map((o) => `${userId}/${o.name}`);
}

async function downloadSha(fileUrl: string | null) {
  expect(fileUrl, "book has a file_url").toBeTruthy();
  const res = await fetch(fileUrl!);
  expect(res.status, `GET ${fileUrl}`).toBe(200);
  return sha256(Buffer.from(await res.arrayBuffer()));
}

test("manual upload creates a retrievable book", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const dialog = await openUploadDialog(page, "Manual Entry");
  await dialog.locator('input[type="file"][accept=".epub,.pdf"]').setInputFiles(fixturePath(EPUB));
  await expect(dialog.getByPlaceholder("Enter book title")).toHaveValue("Zephyr Lantern Field Notes");
  await dialog.getByPlaceholder("Author name").fill("Synthetic Fixture Author");
  await dialog.getByRole("button", { name: "Upload Book" }).click();
  await expect(page.getByText("Book added successfully").first()).toBeVisible();
  await supabaseIdle(page);

  await page.reload();
  await waitForCard(page, "Zephyr Lantern Field Notes");
  await shot(page, "c3-manual-upload-after-reload");

  const rows = (await bookRows(user.id)).filter((b) => b.title === "Zephyr Lantern Field Notes");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ format: "epub", author: "Synthetic Fixture Author" });
  expect(await downloadSha(rows[0]!.file_url)).toBe(fileSha256(fixturePath(EPUB)));
});

test("bulk queue: outcomes shown match what persisted; failures stay queued and retry", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const before = await bookRows(user.id);
  const objectsBefore = await storedObjects(user.id);

  // Disposable fault injection: the first storage upload of the flaky PDF
  // fails with a 500, as a transient network/storage error would.
  let injected = 0;
  await page.route("**/storage/v1/object/books/**", async (route) => {
    if (route.request().method() === "POST" && route.request().url().includes("quillfeather") && injected === 0) {
      injected++;
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"statusCode":"500","error":"injected","message":"injected failure"}' });
    }
    return route.continue();
  });

  const dialog = await openUploadDialog(page, "Bulk Upload");
  const input = dialog.locator('input[type="file"]').last();
  // The EPUB duplicates the manually uploaded title (controlled conflict);
  // the .txt is not a supported format.
  await input.setInputFiles([fixturePath(PDF_OK), fixturePath(PDF_FLAKY), fixturePath(EPUB), fixturePath("not-a-book.txt")]);
  await expect(page.getByText(/not-a-book\.txt/).first()).toBeVisible();
  await expect(dialog.getByText(PDF_OK)).toBeVisible();
  await expect(dialog.getByText(PDF_FLAKY)).toBeVisible();
  await expect(dialog.getByText(EPUB)).toBeVisible();
  await expect(dialog.getByText("not-a-book.txt")).toHaveCount(0); // never queued

  await dialog.getByRole("button", { name: "Upload 3 files" }).click();
  await expect(page.getByText("1 uploaded, 2 failed", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await supabaseIdle(page);
  await shot(page, "c3-bulk-partial");
  expect(injected).toBe(1);

  // Persisted state agrees with what the user was told.
  let rows = await bookRows(user.id);
  const added = rows.filter((r) => !before.some((b) => b.id === r.id));
  expect(added.map((r) => r.title)).toEqual(["basalt-ledger-handbook"]);
  expect(await downloadSha(added[0]!.file_url)).toBe(fileSha256(fixturePath(PDF_OK)));
  // No orphaned uploads for the files that failed.
  expect((await storedObjects(user.id)).length).toBe(objectsBefore.length + 1);

  // Failed items remain in the queue with their reasons; success is marked.
  const item = (name: string) => dialog.locator("div.rounded-lg").filter({ hasText: name }).last();
  await expect(item(EPUB)).toContainText("already exists");
  await expect(item(PDF_FLAKY)).toContainText(/upload/i);
  await expect(item(PDF_OK).getByLabel("Uploaded")).toBeVisible();
  // Status marks and remove buttons must sit inside the visible list, not be
  // pushed past its edge by long names or messages.
  const list = await dialog.getByTestId("upload-queue").boundingBox();
  for (const name of [PDF_OK, PDF_FLAKY, EPUB]) {
    const box = await item(name).getByRole("button", { name: "Remove from queue" }).boundingBox();
    expect(box && list && box.x + box.width <= list.x + list.width, `remove button for ${name} is clipped`).toBeTruthy();
  }

  // Retry: the transient failure succeeds, the duplicate is still refused.
  await dialog.getByRole("button", { name: /^Retry 2 failed/ }).click();
  await expect(page.getByText("1 uploaded, 1 failed", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await supabaseIdle(page);
  rows = await bookRows(user.id);
  expect(rows.filter((r) => r.title === "quillfeather-orbit-atlas")).toHaveLength(1);
  expect(rows.filter((r) => r.title === "Zephyr Lantern Field Notes")).toHaveLength(1);

  // The user resolves the conflict by dropping the duplicate from the queue.
  await item(EPUB).getByRole("button", { name: "Remove from queue" }).click();
  await expect(dialog.getByText(EPUB)).toHaveCount(0);
  await shot(page, "c3-bulk-after-retry");

  await page.keyboard.press("Escape");
  await page.reload();
  for (const title of ["basalt-ledger-handbook", "quillfeather-orbit-atlas", "Zephyr Lantern Field Notes"]) {
    await waitForCard(page, title);
  }
  rows = await bookRows(user.id);
  for (const r of rows.filter((r) => r.file_url)) {
    const name = { "basalt-ledger-handbook": PDF_OK, "quillfeather-orbit-atlas": PDF_FLAKY, "Zephyr Lantern Field Notes": EPUB }[
      r.title
    ];
    if (name !== undefined) expect(await downloadSha(r.file_url)).toBe(fileSha256(fixturePath(name)));
  }
  expect((await storedObjects(user.id)).length).toBe(rows.filter((r) => r.file_url?.includes("/books/")).length);
});

test("wishlist CSV import persists accepted rows and reports the rejected one", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const before = await bookRows(user.id);
  const dialog = await openUploadDialog(page, "CSV Import");
  await dialog.locator('input[type="file"]').first().setInputFiles(fixturePath("wishlist.csv"));
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported 3 of 4 rows", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await supabaseIdle(page);
  await shot(page, "c3-csv-imported");

  await page.reload();
  for (const t of ["PBK30 Wishlist Alpha", "PBK30 Wishlist Beta", "PBK30 Wishlist Gamma"]) await waitForCard(page, t);

  const added = (await bookRows(user.id)).filter((r) => !before.some((b) => b.id === r.id));
  expect(added.map((r) => r.title).sort()).toEqual(["PBK30 Wishlist Alpha", "PBK30 Wishlist Beta", "PBK30 Wishlist Gamma"]);
  for (const r of added) expect(r.status).toBe("wishlist");
  const alpha = added.find((r) => r.title === "PBK30 Wishlist Alpha")!;
  expect(alpha.metadata).toMatchObject({
    isbn: "9780000000101",
    wishlist_priority: 8,
    wishlist_reason: "Recommended in a synthetic thread",
    goodreads_url: "https://example.test/goodreads/alpha",
  });

  const all = await bookRows(user.id);
  recordForRestart("c3", {
    email: user.email,
    userId: user.id,
    books: all.map((r) => ({ id: r.id, title: r.title, status: r.status, file_url: r.file_url, metadata: r.metadata })),
    files: Object.fromEntries(
      all
        .filter((r) => r.file_url?.includes("/books/"))
        .map((r) => [r.id, fileSha256(fixturePath({ "basalt-ledger-handbook": PDF_OK, "quillfeather-orbit-atlas": PDF_FLAKY }[r.title] ?? EPUB))])
    ),
  });
});
