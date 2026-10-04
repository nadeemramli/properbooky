// PBK-30 criterion 4: sign-up confirmation and password reset against local
// GoTrue with Mailpit email capture, in production mode (real auth).
import { randomUUID } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  admin,
  createConfirmedUser,
  firstLink,
  latestMailTo,
  loginThroughUi,
  PASSWORD,
  shot,
  SUPABASE_URL,
  syntheticEmail,
} from "./support";

const NEW_PASSWORD = "Pbk30-Reset-2";
const HIJACK_PASSWORD = "Pbk30-Hijack-3";

// Password grant straight against local GoTrue: proves which password works.
async function canSignIn(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.status === 200;
}

async function requestReset(browser: Browser, email: string) {
  // A fresh, signed-out browser, as the person who forgot their password.
  const context = await browser.newContext();
  const page = await context.newPage();
  const since = new Date();
  await page.goto("/auth/forgot-password");
  await page.getByPlaceholder("Enter your email").fill(email);
  await page.getByRole("button", { name: "Send Reset Link" }).click();
  await expect(page.getByText("Reset email sent")).toBeVisible();
  const mail = await latestMailTo(email, since);
  return { context, page, link: firstLink(mail), subject: mail.subject };
}

async function userRecord(email: string) {
  const { data, error } = await admin().auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

test("a pending sign-up lands on /auth/verify-email and the emailed link confirms it", async ({ page }) => {
  const email = syntheticEmail(`signup-${randomUUID().slice(0, 8)}`);
  const since = new Date();
  await page.goto("/auth/signup");
  await page.getByPlaceholder("name@example.com").fill(email);
  await page.getByPlaceholder("Create a password").fill(PASSWORD);
  await page.getByPlaceholder("Confirm your password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/auth/verify-email");
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await shot(page, "c4-verify-email");
  const pending = await userRecord(email);
  expect(pending, "account created").not.toBeNull();
  expect(pending!.email_confirmed_at ?? null).toBeNull();
  expect(await canSignIn(email, PASSWORD)).toBe(false); // not before confirming

  const mail = await latestMailTo(email, since);
  await page.goto(firstLink(mail));
  await page.waitForURL(/\/library/, { timeout: 30_000 });
  expect((await userRecord(email))!.email_confirmed_at).toBeTruthy();
  expect(await canSignIn(email, PASSWORD)).toBe(true);
});

test("the reset link opens /auth/reset-password and changes only that account", async ({ browser }) => {
  const target = await createConfirmedUser("reset-target");
  const bystander = await createConfirmedUser("reset-bystander");
  const { context, page, link } = await requestReset(browser, target.email);

  await page.goto(link);
  await page.waitForURL("**/auth/reset-password**", { timeout: 30_000 });
  await page.waitForTimeout(1500); // a premature redirect to /library would happen here
  expect(new URL(page.url()).pathname).toBe("/auth/reset-password");
  await expect(page.getByRole("heading", { name: "Reset Your Password" })).toBeVisible();
  await shot(page, "c4-reset-form");

  await page.getByPlaceholder("Enter your new password").fill(NEW_PASSWORD);
  await page.getByPlaceholder("Confirm your new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Reset Password" }).click();
  await expect(page.getByText("Password updated")).toBeVisible();
  await page.waitForURL("**/auth", { timeout: 10_000 });

  expect(await canSignIn(target.email, NEW_PASSWORD)).toBe(true);
  expect(await canSignIn(target.email, PASSWORD)).toBe(false);
  expect(await canSignIn(bystander.email, PASSWORD)).toBe(true);

  await context.close();

  // And the new password works through the real login form (fresh browser;
  // the reset itself leaves the recovery session signed in).
  const fresh = await browser.newContext();
  await loginThroughUi(await fresh.newPage(), target.email, NEW_PASSWORD);
  await fresh.close();
});

test("a spent or tampered reset link is refused with an explanation and changes no account", async ({ browser, page }) => {
  const target = await createConfirmedUser("reset-spent");
  const signedIn = await createConfirmedUser("reset-signed-in");
  const { context, page: first, link } = await requestReset(browser, target.email);
  await first.goto(link); // the legitimate owner uses it once
  await first.waitForURL("**/auth/reset-password**", { timeout: 30_000 });
  await context.close();

  // Someone else, signed in on this browser, opens the spent link, then a
  // tampered one.
  await loginThroughUi(page, signedIn.email);
  const tampered = new URL(link);
  tampered.searchParams.set("token", "pbk30-not-a-real-token");
  for (const [label, url] of [["spent", link], ["tampered", tampered.toString()]] as const) {
    await page.goto(url);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/invalid or has expired/i).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, `c4-${label}-link`);
    await attemptReset(page);
  }

  expect(await canSignIn(target.email, PASSWORD)).toBe(true);
  expect(await canSignIn(signedIn.email, PASSWORD)).toBe(true);
  expect(await canSignIn(signedIn.email, HIJACK_PASSWORD)).toBe(false);
  expect(await canSignIn(target.email, HIJACK_PASSWORD)).toBe(false);
});

// If a reset form is offered at all, using it must not change any password.
async function attemptReset(page: Page) {
  const field = page.getByPlaceholder("Enter your new password");
  if (!(await field.isVisible().catch(() => false))) return;
  await field.fill(HIJACK_PASSWORD);
  await page.getByPlaceholder("Confirm your new password").fill(HIJACK_PASSWORD);
  await page.getByRole("button", { name: "Reset Password" }).click();
  await page.waitForTimeout(2000);
}
