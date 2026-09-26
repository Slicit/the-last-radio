import { asAdmin, expect, test } from "./fixtures";

// specs/features/stations.feature
test.describe(() => {
  test.use(asAdmin);

  test("An admin creates a station", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: "New station" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Night Shift E2E");
    await expect(dialog.getByLabel("Slug")).toHaveValue("night-shift-e2e");
    await dialog.getByLabel("Songs", { exact: true }).fill("5");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Station created")).toBeVisible();
    await expect(page.getByRole("row", { name: /Night Shift E2E/ })).toBeVisible();
    // It goes on air (silence) within seconds.
    await expect(page.getByRole("row", { name: /Night Shift E2E/ }).getByText("On air")).toBeVisible({ timeout: 30_000 });
  });
});

test("Listeners see every active station on the home page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "E2E Main" })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Records" })).toBeVisible();
});

test.describe(() => {
  test.use(asAdmin);
  test("A disabled station disappears for listeners", async ({ page, browser }) => {
    await page.request.post("/api/radios", { data: { slug: "e2e-disabled", name: "E2E Disabled", isActive: false } });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "E2E Disabled" })).toBeVisible(); // admins still see it
    // browser.newContext() inherits test.use() options: start signed out explicitly.
    const visitor = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    await visitor.goto("/");
    await expect(visitor.getByRole("link", { name: "E2E Main" })).toBeVisible();
    await expect(visitor.getByRole("link", { name: "E2E Disabled" })).toHaveCount(0);
  });
});
