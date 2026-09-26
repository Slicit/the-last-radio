import { asAdmin, expect, test } from "./fixtures";

// specs/features/broadcast-hours.feature
test.use(asAdmin);

test("A closed station says when it opens", async ({ page, request }) => {
  await page.goto("/admin");
  const ctx = page.request;
  // A window that can't include "now": one minute, three days from today.
  const day = (new Date().getDay() + 3) % 7;
  const r = await ctx.post("/api/radios", {
    data: { slug: "e2e-closed", name: "E2E Closed", hoursEnabled: true, hoursDays: [day], hoursStart: "22:00", hoursEnd: "22:01", timezone: "UTC", autofillBelowSec: 0 },
  });
  expect(r.ok()).toBe(true);
  await page.goto("/r/e2e-closed");
  await expect(page.getByText(/^Closed · opens \w+ at 22:00$/)).toBeVisible();
  await expect(page.getByText("Songs you add now play when the station opens")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "E2E Closed" }).locator("..").locator("..").getByText("Closed", { exact: true })).toBeVisible();
  void request;
});
