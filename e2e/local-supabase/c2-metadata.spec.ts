// PBK-30 criterion 2: metadata edits through the library UI persist without
// wiping highlights, bookmarks, TOC or recommendations; spectrum, rating and
// wishlist fields persist; a second recommendation keeps the first.
import { test, expect, type Page } from "@playwright/test";

import {
  admin,
  createConfirmedUser,
  type FixtureMetadata,
  loginThroughUi,
  newId,
  recordForRestart,
  shot,
  supabaseIdle,
  trackSupabase,
  waitForCard,
} from "./support";

const BOOK = "PBK30 Annotated Fixture";
const WISH = "PBK30 Wishlist Fixture";

const highlights = [
  { id: newId(), text: "Synthetic highlight one", page: 3, color: "yellow", created_at: "2026-01-01T00:00:00.000Z" },
  { id: newId(), text: "Synthetic highlight two", page: 7, color: "green", created_at: "2026-01-02T00:00:00.000Z" },
];
const bookmarks = [
  { id: newId(), page: 2, label: "Bookmark A", created_at: "2026-01-01T00:00:00.000Z" },
  { id: newId(), page: 9, label: "Bookmark B", created_at: "2026-01-03T00:00:00.000Z" },
];
const toc = [
  { title: "Chapter 1", href: "ch1.xhtml", level: 1 },
  { title: "Chapter 2", href: "ch2.xhtml", level: 1 },
  { title: "Section 2.1", href: "ch2.xhtml#s1", level: 2 },
];

let user: { id: string; email: string };
let bookId: string;
let wishId: string;
let firstRec: Record<string, unknown>;
let highlightRows: Array<Record<string, unknown>>;

async function metadataOf(id: string) {
  const { data, error } = await admin().from("books").select("metadata").eq("id", id).single();
  if (error) throw error;
  return (data as { metadata: FixtureMetadata }).metadata;
}

async function openDetails(page: Page, title: string) {
  const card = await waitForCard(page, title);
  await card.hover();
  await card.getByRole("button", { name: "Details" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Book Details")).toBeVisible();
  return dialog;
}

const settle = (page: Page) => supabaseIdle(page);

test.beforeEach(({ page }) => trackSupabase(page));

test.beforeAll(async () => {
  user = await createConfirmedUser("metadata");
  firstRec = {
    id: newId(),
    book_id: "",
    user_id: user.id,
    recommender_name: "Recommender One",
    recommendation_text: "Seeded first recommendation",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const { data, error } = await admin()
    .from("books")
    .insert([
      {
        user_id: user.id,
        title: BOOK,
        author: "Synthetic Author",
        format: "epub",
        status: "reading",
        file_url: null,
        metadata: {
          publisher: "Synthetic Press",
          language: "en",
          isbn: "9780000000001",
          description: "Synthetic fixture for PBK-30",
          highlights,
          bookmarks,
          toc,
          recommendations: [firstRec],
        },
      },
      {
        user_id: user.id,
        title: WISH,
        author: "Wishful Author",
        format: "pdf",
        status: "wishlist",
        file_url: null,
        metadata: { language: "en" },
      },
    ])
    .select("id, title");
  if (error) throw error;
  const inserted = data as Array<{ id: string; title: string }>;
  bookId = inserted.find((b) => b.title === BOOK)!.id;
  wishId = inserted.find((b) => b.title === WISH)!.id;
  firstRec.book_id = bookId;
  await admin().from("books").update({ metadata: { ...(await metadataOf(bookId)), recommendations: [firstRec] } }).eq("id", bookId);

  // Highlights also live in their own table; they must survive metadata edits.
  const rows = await admin()
    .from("highlights")
    .insert([
      { book_id: bookId, user_id: user.id, text: "Table highlight alpha", page: 4 },
      { book_id: bookId, user_id: user.id, text: "Table highlight beta", page: 8 },
    ])
    .select("*");
  if (rows.error) throw rows.error;
  highlightRows = rows.data as Array<Record<string, unknown>>;
});

test("editing one metadata field keeps highlights, bookmarks, TOC and recommendations", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const before = await metadataOf(bookId);

  const dialog = await openDetails(page, BOOK);
  await dialog.getByRole("button", { name: "Edit Details" }).click();
  const publisher = dialog.getByPlaceholder("Publisher");
  await publisher.fill("Edited Press");
  await dialog.getByRole("button", { name: "Save Changes" }).last().click();
  await expect(page.getByText("Book details updated successfully").first()).toBeVisible();
  await settle(page);

  await page.reload();
  const reopened = await openDetails(page, BOOK);
  await expect(reopened.getByText("Edited Press")).toBeVisible();
  await shot(page, "c2-publisher-after-reload");

  const after = await metadataOf(bookId);
  expect(after.publisher).toBe("Edited Press");
  expect(after.highlights).toEqual(before.highlights);
  expect(after.bookmarks).toEqual(before.bookmarks);
  expect(after.toc).toEqual(before.toc);
  expect(after.recommendations).toEqual(before.recommendations);
  expect(after.isbn).toBe(before.isbn);
  expect(after.description).toBe(before.description);

  const { data: tableRows } = await admin().from("highlights").select("*").eq("book_id", bookId).order("page");
  expect(tableRows).toEqual(highlightRows.sort((a, b) => Number(a.page) - Number(b.page)));
});

test("knowledge spectrum and manual rating sliders persist their final values", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const dialog = await openDetails(page, BOOK);
  await dialog.getByRole("tab", { name: "Metadata" }).click();
  const [spectrum, rating] = [dialog.getByRole("slider").nth(0), dialog.getByRole("slider").nth(1)];

  // Unset values start at 0.5 and 2.5. Three steps right / two steps left.
  await spectrum.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await rating.focus();
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowLeft");
  await settle(page);
  await expect(spectrum).toHaveAttribute("aria-valuenow", "0.8");
  await expect(rating).toHaveAttribute("aria-valuenow", "1.5");

  await page.reload();
  const reopened = await openDetails(page, BOOK);
  await reopened.getByRole("tab", { name: "Metadata" }).click();
  await expect(reopened.getByRole("slider").nth(0)).toHaveAttribute("aria-valuenow", "0.8");
  await expect(reopened.getByRole("slider").nth(1)).toHaveAttribute("aria-valuenow", "1.5");
  await shot(page, "c2-sliders-after-reload");

  const meta = await metadataOf(bookId);
  expect(meta.knowledge_spectrum).toBeCloseTo(0.8, 5);
  expect(meta.manual_rating).toBeCloseTo(1.5, 5);
  expect(meta.highlights).toEqual(highlights);
});

test("a stored zero stays zero instead of snapping back to the default", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const dialog = await openDetails(page, BOOK);
  await dialog.getByRole("tab", { name: "Metadata" }).click();
  await dialog.getByRole("slider").nth(0).focus();
  await page.keyboard.press("Home");
  await settle(page);
  expect((await metadataOf(bookId)).knowledge_spectrum).toBe(0);

  await page.reload();
  const reopened = await openDetails(page, BOOK);
  await reopened.getByRole("tab", { name: "Metadata" }).click();
  await expect(reopened.getByRole("slider").nth(0)).toHaveAttribute("aria-valuenow", "0");
  await expect(reopened.getByText("0.0", { exact: true })).toBeVisible();

  // Leave a non-default value for the restart check.
  await reopened.getByRole("slider").nth(0).focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
  await settle(page);
  expect((await metadataOf(bookId)).knowledge_spectrum).toBeCloseTo(0.7, 5);
});

test("wishlist priority and notes persist", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const dialog = await openDetails(page, WISH);
  await dialog.getByRole("tab", { name: "Metadata" }).click();
  const priority = dialog.getByRole("slider").nth(2);
  await priority.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  const notes = dialog.getByPlaceholder("Add notes about this book...");
  await notes.click();
  await page.keyboard.type("Synthetic wishlist note");
  await settle(page);
  await expect(notes).toHaveValue("Synthetic wishlist note");

  await page.reload();
  const reopened = await openDetails(page, WISH);
  await reopened.getByRole("tab", { name: "Metadata" }).click();
  await expect(reopened.getByRole("slider").nth(2)).toHaveAttribute("aria-valuenow", "4");
  await expect(reopened.getByPlaceholder("Add notes about this book...")).toHaveValue("Synthetic wishlist note");
  await shot(page, "c2-wishlist-after-reload");

  const meta = await metadataOf(wishId);
  expect(meta.wishlist_priority).toBe(4);
  expect(meta.wishlist_notes).toBe("Synthetic wishlist note");
});

test("adding a second recommendation keeps the first", async ({ page }) => {
  await loginThroughUi(page, user.email);
  const dialog = await openDetails(page, BOOK);
  await dialog.getByRole("tab", { name: "Recommendations" }).click();
  await expect(dialog.getByText("Recommender One")).toBeVisible();
  await dialog.getByPlaceholder("Who recommended this book?").fill("Recommender Two");
  await dialog.getByPlaceholder("Why did they recommend this book?").fill("Second, added through the UI");
  await dialog.getByRole("button", { name: "Add Recommendation" }).click();
  await expect(page.getByText("Recommendation added successfully").first()).toBeVisible();
  await settle(page);

  await page.reload();
  const reopened = await openDetails(page, BOOK);
  await reopened.getByRole("tab", { name: "Recommendations" }).click();
  await expect(reopened.getByText("Recommender One")).toBeVisible();
  await expect(reopened.getByText("Recommender Two")).toBeVisible();
  await shot(page, "c2-recommendations-after-reload");

  const meta = await metadataOf(bookId);
  expect((meta.recommendations ?? []).map((r) => r.recommender_name)).toEqual([
    "Recommender One",
    "Recommender Two",
  ]);
  expect(meta.highlights).toEqual(highlights);
  expect(meta.bookmarks).toEqual(bookmarks);
  expect(meta.toc).toEqual(toc);

  recordForRestart("c2", {
    email: user.email,
    userId: user.id,
    bookId,
    wishId,
    metadata: meta,
    wishMetadata: await metadataOf(wishId),
    highlightRows: (await admin().from("highlights").select("*").eq("book_id", bookId).order("page")).data,
  });
});
