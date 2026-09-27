import { asPlayer, expect, test } from "./fixtures";

// specs/features/adding-songs.feature (these hit YouTube through yt-dlp)
test.use(asPlayer);

test("Searching for a song by name, then adding it", { tag: "@network" }, async ({ page }) => {
  await page.goto("/r/e2e-main");
  const box = page.getByRole("combobox", { name: "Search for a song" });
  await box.fill("nina simone feeling good");
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible({ timeout: 30_000 });
  await expect(options.first()).toContainText(/Feeling Good/i);
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  await box.press("Enter");
  await expect(page.getByText(/^“.*Feeling Good.*” added$/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/It's next up\.|in line\./)).toBeVisible();
  await expect(box).toHaveValue("");
});

test("Songs that can't be added say why", { tag: "@network" }, async ({ page }) => {
  await page.goto("/r/e2e-main");
  const box = page.getByRole("combobox", { name: "Search for a song" });
  await box.fill("nina simone feeling good");
  // Added in the previous test: now on air or in line.
  await expect(page.getByRole("option").filter({ hasText: /On air now|Already in line/ }).first()).toBeVisible({ timeout: 30_000 });
  const blocked = page.locator('[role="option"][aria-disabled="true"]').first();
  await expect(blocked).toHaveAttribute("aria-selected", "false");
});

test("Pasting a link", async ({ page }) => {
  await page.goto("/r/e2e-main");
  await page.getByRole("combobox", { name: "Search for a song" }).fill("https://www.youtube.com/watch?v=wouKI_myXxk");
  await expect(page.getByRole("option", { name: /Add this link/ })).toBeVisible();
});

test("The card says where songs can come from", async ({ page }) => {
  await page.goto("/r/e2e-main");
  await expect(page.getByText(/on YouTube or SoundCloud, or paste a link from YouTube, SoundCloud, Bandcamp,\s+Mixcloud and more/)).toBeVisible();
});

test("Searching SoundCloud instead of YouTube", { tag: "@network" }, async ({ page }) => {
  await page.goto("/r/e2e-main");
  await page.getByRole("radio", { name: "SoundCloud" }).click();
  const box = page.getByRole("combobox", { name: "Search for a song" });
  await expect(box).toHaveAttribute("placeholder", /Search SoundCloud/);
  await box.fill("daft punk around the world");
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("from SoundCloud")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "SoundCloud" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "YouTube" }).click();
});

test("the results open below the search box, not over it", async ({ page }) => {
  await page.goto("/r/e2e-main");
  const box = page.getByRole("combobox", { name: "Search for a song" });
  await box.fill("https://www.youtube.com/watch?v=wouKI_myXxk");
  const panel = page.getByRole("listbox");
  await expect(panel).toBeVisible();
  const [input, list] = [await box.boundingBox(), await panel.boundingBox()];
  expect(list!.y).toBeGreaterThanOrEqual(input!.y + input!.height);
});

test("Search still answers when YouTube can't be reached", async ({ page }) => {
  // The server's fallback is covered by unit tests; here, how the page shows it.
  await page.route("**/api/search?**", (r) =>
    r.fulfill({
      json: {
        source: "soundcloud",
        fallbackFrom: "youtube",
        results: [{ videoId: "1", sourceKey: "Soundcloud:e2e-fallback", sourceUrl: "https://soundcloud.com/e2e/fallback", title: "Fallback Song", artist: "E2E", durationSec: 200, thumbnailUrl: null, views: null, source: "soundcloud" }],
      },
    }),
  );
  await page.goto("/r/e2e-main");
  await page.getByRole("radio", { name: "YouTube" }).click();
  await page.getByRole("combobox", { name: "Search for a song" }).fill("daft punk");
  await expect(page.getByRole("status").filter({ hasText: "YouTube isn't reachable right now" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Fallback Song/ })).toBeVisible();
});
