import { asAdmin, expect, test } from "./fixtures";

// specs/features/song-records.feature and queue-and-alfred.feature, on the seeded (off-air) station.
test.use(asAdmin);

test("Browsing a station's songs", async ({ page }) => {
  await page.goto("/r/e2e-records");
  await page.getByRole("tab", { name: "Songs" }).click();
  for (const sort of ["Most played", "Crowd favourites", "Most downvoted", "Recently played"]) {
    await expect(page.getByRole("radio", { name: sort })).toBeVisible();
  }
  await expect(page.getByText("Crowd Favourite", { exact: true })).toBeVisible();
  await expect(page.getByText("3 plays · added by 1 person")).toBeVisible();
  const votedOff = page.getByText("Voted Off Tune", { exact: true }).locator("xpath=ancestor::div[contains(@class,'py-2.5')]");
  await expect(votedOff.getByText("Voted off", { exact: true })).toBeVisible();
});

test("Adding a song again", async ({ page }) => {
  await page.goto("/r/e2e-records");
  await page.getByRole("tab", { name: "Songs" }).click();
  const row = page.getByText("Crowd Favourite", { exact: true }).locator("xpath=ancestor::div[contains(@class,'py-2.5')]");
  await row.getByRole("button", { name: /Add “Crowd Favourite” again/ }).click();
  await expect(page.getByText("“Crowd Favourite” added")).toBeVisible();
  await expect(row.getByText("In line")).toBeVisible();
});

test("Alfred's picks are labelled", async ({ page }) => {
  await page.goto("/r/e2e-records");
  await expect(page.getByText("Alfred's picks keep the music going. Songs people add always play first.")).toBeVisible();
  await expect(page.getByText("Alfred Pick", { exact: true }).locator("xpath=ancestor::div[contains(@class,'py-2.5')]")).toContainText("Alfred");
});

// specs/features/song-health.feature
test("Finding another copy", async ({ page }) => {
  await page.goto("/r/e2e-records");
  await page.getByRole("tab", { name: "Songs" }).click();
  const row = page.getByText("Vanished Hit (Official Video)", { exact: true }).locator("xpath=ancestor::div[contains(@class,'py-2.5')]");
  await expect(row.getByText("No longer available")).toBeVisible();
  await row.getByRole("button", { name: "Find it" }).click();
  await expect(page.getByRole("combobox", { name: "Search for a song" })).toHaveValue("Vanished Hit");
});
