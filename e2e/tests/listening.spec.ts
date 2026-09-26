import { expect, test } from "./fixtures";

// specs/features/listening.feature
test("Tuning in from a station page", async ({ page }) => {
  await page.goto("/r/e2e-main");
  await page.getByRole("button", { name: "Listen live" }).click();
  const bar = page.locator("div.fixed.bottom-0");
  await expect(bar).toContainText("E2E Main");
  await expect(page.getByRole("button", { name: "Stop" }).first()).toBeVisible({ timeout: 20_000 });
});

test("Listening over plain HTTP on a local network", async ({ page, request }) => {
  // The test stack is served over http from a non-localhost name: not a secure context.
  await page.goto("/r/e2e-main");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "Listen live" }).click();
  // The heartbeat (which used crypto.randomUUID) runs once audio plays; the fixture fails on page errors.
  await expect
    .poll(async () => (await (await request.get("/api/radios/e2e-main")).json()).listeners, { timeout: 30_000 })
    .toBeGreaterThan(0);
});
