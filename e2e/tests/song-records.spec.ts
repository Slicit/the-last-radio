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

// specs/features/upvotes.feature
test.describe("upvotes", () => {
  test.use({ storageState: ".auth/player.json" });

  test("Upvoting a song, and three a day", async ({ page }) => {
    await page.goto("/r/e2e-records");
    await page.getByRole("tab", { name: "Songs" }).click();
    const rowOf = (title: string) =>
      page.getByText(title, { exact: true }).locator("xpath=ancestor::div[contains(@class,'py-2.5')]");
    const fav = rowOf("Crowd Favourite");
    await fav.getByRole("button", { name: "Upvote" }).click();
    await expect(page.getByText("Upvoted: Alfred will play it more")).toBeVisible();
    await expect(fav.getByRole("button", { name: "Take back your upvote" })).toHaveAttribute("aria-pressed", "true");
    await expect(fav.getByText(/1 upvote\b/)).toBeVisible();
    // Use up the day's upvotes on two more songs.
    await rowOf("Alfred Pick").getByRole("button", { name: "Upvote" }).click();
    await rowOf("Voted Off Tune").getByRole("button", { name: "Upvote" }).click();
    await expect(rowOf("Voted Off Tune").getByRole("button", { name: "Take back your upvote" })).toBeVisible();
    const vanished = rowOf("Vanished Hit (Official Video)").getByRole("button", { name: "Upvote" });
    await expect(vanished).toBeDisabled();
    await expect(vanished).toHaveAttribute("title", "No upvotes left today");
    // Taking one back frees one.
    await fav.getByRole("button", { name: "Take back your upvote" }).click();
    await expect(vanished).toBeEnabled();
  });
});
