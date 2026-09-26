import { asAdmin, asPlayer, expect, test } from "./fixtures";

// specs/features/skipping.feature
test.describe("Only people listening can vote", { tag: "@network" }, () => {
  test.use(asPlayer);

  test("Only people listening can vote", async ({ page, browser }) => {
    // Waits for a real song to download from YouTube and go on air.
    test.setTimeout(180_000);
    // Make sure something the player didn't add is on air.
    const admin = await browser.newContext(asAdmin);
    const a = await admin.newPage();
    await a.goto("/r/e2e-main");
    const detail = await (await a.request.get("/api/radios/e2e-main")).json();
    if (!detail.nowPlaying || detail.nowPlaying.pushedBy?.displayName !== "Alex Admin") {
      const box = a.getByRole("combobox", { name: "Search for a song" });
      await box.fill("air sexy boy");
      await expect(a.locator('[role="option"][aria-disabled="false"]').first()).toBeVisible({ timeout: 30_000 });
      await box.press("Enter");
      await expect(a.getByText(/” added$/)).toBeVisible({ timeout: 20_000 });
      if (detail.nowPlaying) await a.getByRole("button", { name: "Skip" }).click();
    }
    await admin.close();

    await page.goto("/r/e2e-main");
    const vote = page.getByRole("button", { name: /Vote to skip/ });
    await expect(vote).toBeVisible({ timeout: 90_000 }); // download + first airing
    await expect(vote).toBeDisabled();
    await expect(page.getByText("Tune in to vote")).toBeVisible();
    await page.getByRole("button", { name: "Listen live" }).click();
    await expect(vote).toBeEnabled({ timeout: 30_000 });
  });
});

test("Between two songs, the next one is announced instead of dead air", async ({ page }) => {
  // Freeze the page in the gap right after a skip: nothing on air yet, songs lined up.
  await page.route("**/api/radios/e2e-paging", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.nowPlaying = null;
    body.radio.hours = { open: true, next: null, closesAt: null };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/r/e2e-paging");
  await expect(page.getByText("Coming up in a moment…")).toBeVisible();
  await expect(page.getByText("Paging Song 01").first()).toBeVisible();
  await expect(page.getByText("Dead air")).toHaveCount(0);
});
