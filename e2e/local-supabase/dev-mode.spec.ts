// PBK-30 setup repair: `npm run dev` (dev-mode sign-in) against a local stack
// where the dev account's id differs from FLAGS.DEV_USER_ID, as happens when
// the account was created by sign-up instead of the seed. Two tabs load the
// library at once; the dev session's own id must own the data, with no RLS
// rejections and exactly one default book.
import { test, expect, type Page } from "@playwright/test";
import { FLAGS } from "../../lib/config/flags";
import { defaultBookId } from "../../lib/utils/default-books";
import { admin, bookRows, shot } from "./support";

const DEV_EMAIL = FLAGS.DEV_USER_EMAIL;

function watch(page: Page) {
  const problems: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/rest/v1/books") && r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} books`);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && /row-level security|permission denied|dev session/i.test(m.text())) problems.push(m.text().slice(0, 160));
  });
  return problems;
}

test("dev mode uses the signed-in dev account's own id and provisions once", async ({ browser }) => {
  // Deleting the dev account cascades to its books: disposable stacks only.
  test.skip(process.env.PBK30_DISPOSABLE !== "1", "set PBK30_DISPOSABLE=1 on a disposable stack (scripts/local-supabase.sh reset)");
  // Recreate the dev account with a random id (not FLAGS.DEV_USER_ID).
  const { data: list } = await admin().auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of list.users.filter((u) => u.email === DEV_EMAIL)) await admin().auth.admin.deleteUser(u.id);
  const { data, error } = await admin().auth.admin.createUser({
    email: DEV_EMAIL,
    password: process.env.NEXT_PUBLIC_DEV_PASSWORD || "development",
    email_confirm: true,
  });
  if (error) throw error;
  const devId = data.user.id;
  expect(devId).not.toBe(FLAGS.DEV_USER_ID);

  const context = await browser.newContext();
  const [a, b] = [await context.newPage(), await context.newPage()];
  const problems = [...[a, b].map(watch)];
  await Promise.all([a.goto("/library"), b.goto("/library")]);
  for (const page of [a, b]) {
    await expect(page.getByRole("heading", { name: "Sample PDF Book" }).first()).toBeVisible({ timeout: 60_000 });
  }
  await a.waitForTimeout(2000);
  await shot(a, "dev-mode-library");

  const rows = await bookRows(devId);
  expect(rows.map((r) => r.id)).toEqual([await defaultBookId(devId)]);
  expect(await bookRows(FLAGS.DEV_USER_ID)).toEqual([]);
  expect(problems.flat()).toEqual([]);
  await context.close();
});
