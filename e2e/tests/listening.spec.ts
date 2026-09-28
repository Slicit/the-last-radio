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

test("One station at a time, even across tabs", async ({ context }) => {
  // Two tabs of the same browser: starting one stops the other.
  const first = await context.newPage();
  await first.goto("/r/e2e-main");
  await first.getByRole("button", { name: "Listen live" }).click();
  const firstBar = first.locator("div.fixed.bottom-0");
  await expect(firstBar.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 20_000 });

  const second = await context.newPage();
  await second.goto("/r/e2e-main");
  await second.getByRole("button", { name: "Listen live" }).click();

  await expect(firstBar.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(firstBar).toContainText("Paused: another tab started playing");
  // Picking it up again there stops the other tab in turn.
  await firstBar.getByRole("button", { name: "Play" }).click();
  await expect(second.locator("div.fixed.bottom-0").getByRole("button", { name: "Play" })).toBeVisible();
});
