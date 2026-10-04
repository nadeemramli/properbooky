// PBK-30 criterion 5: after the Next server and the Supabase containers were
// stopped and started again (data volumes kept), everything criteria 2-3
// persisted is still there, through the UI and in the database.
import { test, expect, type Page } from "@playwright/test";

import {
  admin,
  bookRows,
  loginThroughUi,
  readRestartState,
  sha256,
  shot,
  waitForCard,
  type FixtureMetadata,
} from "./support";

interface C2 {
  email: string;
  userId: string;
  bookId: string;
  wishId: string;
  metadata: FixtureMetadata;
  wishMetadata: FixtureMetadata;
  highlightRows: Array<Record<string, unknown>>;
}
interface C3 {
  email: string;
  userId: string;
  books: Array<{ id: string; title: string; status: string; file_url: string | null; metadata: unknown }>;
  files: Record<string, string>;
}

const state = () => readRestartState() as { c2: C2; c3: C3 };

async function openDetails(page: Page, title: string) {
  const card = await waitForCard(page, title);
  await card.hover();
  await card.getByRole("button", { name: "Details" }).click();
  return page.getByRole("dialog");
}

test("metadata, annotations and recommendations survive the restart", async ({ page }) => {
  const { c2 } = state();
  const { data, error } = await admin().from("books").select("metadata").eq("id", c2.bookId).single();
  if (error) throw error;
  expect(data.metadata).toEqual(c2.metadata);
  const wish = await admin().from("books").select("metadata").eq("id", c2.wishId).single();
  expect(wish.data?.metadata).toEqual(c2.wishMetadata);
  const rows = await admin().from("highlights").select("*").eq("book_id", c2.bookId).order("page");
  expect(rows.data).toEqual(c2.highlightRows);

  await loginThroughUi(page, c2.email);
  const dialog = await openDetails(page, "PBK30 Annotated Fixture");
  await expect(dialog.getByText("Edited Press")).toBeVisible();
  await dialog.getByRole("tab", { name: "Metadata" }).click();
  await expect(dialog.getByRole("slider").nth(0)).toHaveAttribute("aria-valuenow", String(c2.metadata.knowledge_spectrum));
  await expect(dialog.getByRole("slider").nth(1)).toHaveAttribute("aria-valuenow", String(c2.metadata.manual_rating));
  await dialog.getByRole("tab", { name: "Recommendations" }).click();
  await expect(dialog.getByText("Recommender One")).toBeVisible();
  await expect(dialog.getByText("Recommender Two")).toBeVisible();
  await shot(page, "c5-metadata-after-restart");
  await page.keyboard.press("Escape");

  const wishDialog = await openDetails(page, "PBK30 Wishlist Fixture");
  await wishDialog.getByRole("tab", { name: "Metadata" }).click();
  await expect(wishDialog.getByPlaceholder("Add notes about this book...")).toHaveValue("Synthetic wishlist note");
});

test("uploaded files and imported CSV rows survive the restart", async ({ page }) => {
  const { c3 } = state();
  const now = await bookRows(c3.userId);
  const pick = (r: { id: string; title: string; status: string; file_url: string | null; metadata: unknown }) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    file_url: r.file_url,
    metadata: r.metadata,
  });
  expect(now.map(pick)).toEqual(c3.books);

  for (const [id, expected] of Object.entries(c3.files)) {
    const url = now.find((r) => r.id === id)!.file_url as string;
    const res = await fetch(url);
    expect(res.status, url).toBe(200);
    expect(sha256(Buffer.from(await res.arrayBuffer()))).toBe(expected);
  }

  await loginThroughUi(page, c3.email);
  for (const r of c3.books) await waitForCard(page, r.title);
  await shot(page, "c5-library-after-restart");
  expect(c3.books.filter((b) => b.status === "wishlist").map((b) => b.title).sort()).toEqual([
    "PBK30 Wishlist Alpha",
    "PBK30 Wishlist Beta",
    "PBK30 Wishlist Gamma",
  ]);
});
