import { test, expect } from "@playwright/test";

test.describe("smoke", () => {
  test("auth page renders the login form or dev mode enters the app", async ({ page }) => {
    await page.goto("/auth");
    // Production: the login form renders. Dev mode: the auto-signed-in dev
    // user is redirected into the app shell.
    const loginForm = page.getByText(/terms of service/i);
    const appShell = page.getByRole("link", { name: "ProperBooky" });
    await expect(loginForm.or(appShell).first()).toBeVisible({ timeout: 15_000 });
  });

  test("home page responds without a server error", async ({ page }) => {
    const response = await page.goto("/");
    expect(response, "no response for /").toBeTruthy();
    expect(response!.status(), "status should not be 5xx").toBeLessThan(500);
    // Dev mode bypasses auth and shows the dashboard; otherwise we land on /auth.
    await expect(
      page.getByRole("heading", { name: "Dashboard" }).or(page.getByText(/terms of service/i))
    ).toBeVisible({ timeout: 15_000 });
  });

  test("library route responds without a server error", async ({ page }) => {
    const response = await page.goto("/library");
    expect(response, "no response for /library").toBeTruthy();
    expect(response!.status(), "status should not be 5xx").toBeLessThan(500);
  });
});
