import { asAdmin, expect, test } from "./fixtures";

// specs/features/stations.feature
test.describe(() => {
  test.use(asAdmin);

  test("An admin creates a station", async ({ page }) => {
    await page.goto("/admin/stations");
    await page.getByRole("link", { name: "New station" }).click();
    await expect(page).toHaveURL(/\/admin\/stations\/new$/);
    await page.getByLabel("Name").fill("Night Shift E2E");
    await expect(page.getByLabel("Address")).toHaveValue("night-shift-e2e");
    await page.getByLabel("Songs per person").fill("5");
    await page.getByRole("region", { name: "Save" }).getByRole("button", { name: "Create station" }).click();
    await expect(page.getByText("Station created")).toBeVisible();
    // Straight on to the station's own editor, ready for people and hours.
    await expect(page).toHaveURL(/\/admin\/stations\/night-shift-e2e$/);
    await expect(page.getByRole("heading", { name: "Night Shift E2E" })).toBeVisible();
    await page.getByRole("link", { name: "Stations", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/stations$/);
    await expect(page.getByRole("row", { name: /Night Shift E2E/ })).toBeVisible();
    // It goes on air (silence) within seconds.
    await expect(page.getByRole("row", { name: /Night Shift E2E/ }).getByText("On air")).toBeVisible({ timeout: 30_000 });
  });

  test("Unsaved station changes aren't lost by accident", async ({ page }) => {
    await page.goto("/admin/stations/e2e-main");
    await expect(page.getByLabel("Description")).toBeVisible();
    await expect(page.getByText("Unsaved changes")).toBeHidden();
    await page.getByLabel("Description").fill("Edited, not saved");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    page.once("dialog", (d) => d.dismiss()); // "Leave without saving?" → stay
    await page.locator("header").getByRole("link", { name: "Radios" }).click();
    await expect(page).toHaveURL(/\/admin\/stations\/e2e-main$/);
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Unsaved changes")).toBeHidden();
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

// specs/features/listener-stats.feature
test.describe(() => {
  test.use(asAdmin);
  test("Admins see listeners over time", async ({ page }) => {
    await page.goto("/admin");
    const card = page.getByText("Listeners", { exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(card.getByRole("radio", { name: "7 days" })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByRole("region", { name: "All stations" })).toBeVisible();
    await card.getByRole("radio", { name: "3 months" }).click();
    await expect(card.getByRole("radio", { name: "3 months" })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByRole("region", { name: "All stations" })).toBeVisible();
  });
});

// specs/features/stations.feature
test.describe(() => {
  test.use(asAdmin);
  test("Admin pages have their own menu", async ({ page }) => {
    await page.goto("/admin");
    const menu = page.getByRole("navigation", { name: "Admin" });
    for (const [label, path, heading] of [
      ["Feedback", "/admin/feedback", "Feedback"],
      ["Stations", "/admin/stations", "Stations"],
      ["Users", "/admin/users", "Users"],
      ["Settings", "/admin/settings", "Settings"],
      ["Overview", "/admin", "Overview"],
    ]) {
      await menu.getByRole("link", { name: new RegExp(`^${label}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    // Users: search, filters and the page count are always there.
    await menu.getByRole("link", { name: "Users" }).click();
    await page.getByRole("searchbox", { name: "Search people" }).fill("no-such-person-xyz");
    await expect(page.getByText("Nobody matches “no-such-person-xyz”.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("0 people");
  });

  test("Saving a station is always in sight", async ({ page }) => {
    await page.goto("/admin/stations/e2e-main");
    const bar = page.getByRole("region", { name: "Save" });
    await expect(bar).toContainText("All changes saved");
    await expect(bar.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await page.getByLabel("Description").fill("Saved from the bar (e2e)");
    await expect(bar).toContainText("Unsaved changes");
    await bar.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("[data-sonner-toast]").getByText("Saved", { exact: true })).toBeVisible();
    await expect(bar).toContainText("All changes saved");
  });
});
