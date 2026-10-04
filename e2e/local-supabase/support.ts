// Shared helpers for the PBK-30 local-Supabase runtime suite.
//
// Everything here talks to the LOCAL stack only (scripts/local-supabase.sh).
// The service-role client exists solely to create synthetic fixtures and to
// assert what the browser actually persisted; it never runs in the browser.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export function assertLocalStack() {
  const local = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/;
  if (!local.test(SUPABASE_URL) || !local.test(MAILPIT_URL)) {
    throw new Error(
      `PBK-30 suite refuses to run against a non-local Supabase (${SUPABASE_URL || "unset"}).`
    );
  }
  if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required (local stack key).");
}

let adminClient: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  assertLocalStack();
  adminClient ??= createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export const RUN_ID = process.env.PBK30_RUN_ID ?? `run${Date.now().toString(36)}`;
export const PASSWORD = "Pbk30-Synthetic-1";

export function syntheticEmail(label: string) {
  return `pbk30-${RUN_ID}-${label}@example.test`.toLowerCase();
}

/** Creates a confirmed synthetic account directly on the local stack. */
export async function createConfirmedUser(label: string) {
  // Unique per call: a retried worker re-runs beforeAll with a fresh account.
  const email = syntheticEmail(`${label}-${randomUUID().slice(0, 8)}`);
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return { id: data.user.id, email };
}

export async function loginThroughUi(page: Page, email: string, password = PASSWORD) {
  await page.goto("/auth");
  await page.getByPlaceholder("name@example.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: "Sign in with Email" }).click();
  await page.waitForURL("**/library**", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Library", level: 2 })).toBeVisible();
}

export async function waitForCard(page: Page, title: string) {
  const card = page.locator("div.rounded-lg.border").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card.first()).toBeVisible({ timeout: 30_000 });
  return card.first();
}

export interface BookRow {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  format: string | null;
  status: string;
  file_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function bookRows(userId: string): Promise<BookRow[]> {
  const { data, error } = await admin().from("books").select("*").eq("user_id", userId).order("created_at");
  if (error) throw new Error(`books for ${userId}: ${error.message}`);
  return (data ?? []) as BookRow[];
}

// --- Mailpit (local email capture) -----------------------------------------

type MailSummary = { ID: string; Subject: string; Created: string };

export async function latestMailTo(email: string, since: Date, timeoutMs = 30_000): Promise<{ subject: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    if (res.ok) {
      const body = (await res.json()) as { messages: MailSummary[] };
      const fresh = body.messages.filter((m) => new Date(m.Created).getTime() >= since.getTime() - 1000);
      if (fresh.length) {
        const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${fresh[0]!.ID}`)).json()) as {
          Subject: string;
          Text: string;
          HTML: string;
        };
        return { subject: msg.Subject, text: msg.Text, html: msg.HTML };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${email} within ${timeoutMs}ms`);
}

export function firstLink(mail: { text: string; html: string }) {
  const match = /https?:\/\/[^\s"'<>)]+\/auth\/v1\/verify[^\s"'<>)]*/.exec(mail.html || mail.text);
  if (!match) throw new Error("no verification link in email");
  return match[0].replace(/&amp;/g, "&");
}

// --- fixtures --------------------------------------------------------------

export const FIXTURE_LIBRARY = path.resolve(__dirname, "../../desktop/e2e-desktop/fixtures/library");
export const FIXTURES = path.resolve(__dirname, "fixtures");
export const fixturePath = (name: string) =>
  existsSync(path.join(FIXTURES, name)) ? path.join(FIXTURES, name) : path.join(FIXTURE_LIBRARY, name);
export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
export const fileSha256 = (file: string) => sha256(readFileSync(file));
export const newId = () => randomUUID();

// --- cross-phase state (criterion 5 re-checks after restart) ----------------

const STATE_FILE = path.resolve(process.env.PBK30_ARTIFACTS ?? "test-results/pbk30", "state.json");

export type RestartExpectations = Record<string, unknown>;

export function recordForRestart(key: string, value: unknown) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const current = existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as RestartExpectations) : {};
  current[key] = value;
  writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));
}

export function readRestartState(): RestartExpectations {
  if (!existsSync(STATE_FILE)) throw new Error(`no pre-restart state at ${STATE_FILE}; run the before phase first`);
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as RestartExpectations;
}

export async function shot(page: Page, name: string) {
  const dir = path.resolve(process.env.PBK30_ARTIFACTS ?? "test-results/pbk30", "screens");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

// Resolves once no request to the local Supabase API has been in flight for
// `quietMs`. (networkidle never settles: auth keeps a background refresh.)
const inflight = new WeakMap<Page, Set<unknown>>();
export function trackSupabase(page: Page) {
  const pending = new Set<unknown>();
  inflight.set(page, pending);
  const isApi = (url: string) => url.startsWith(SUPABASE_URL);
  page.on("request", (r) => isApi(r.url()) && pending.add(r));
  page.on("requestfinished", (r) => pending.delete(r));
  page.on("requestfailed", (r) => pending.delete(r));
}
export async function supabaseIdle(page: Page, quietMs = 750, timeoutMs = 20_000) {
  const pending = inflight.get(page);
  if (!pending) throw new Error("call trackSupabase(page) first");
  const deadline = Date.now() + timeoutMs;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (pending.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Supabase requests still in flight after ${timeoutMs}ms`);
}
