import { asAdmin, expect, test } from "./fixtures";

// specs/features/station-transfer.feature
test.describe(() => {
  test.use(asAdmin);

  test("Exporting a station", async ({ page }) => {
    await page.goto("/admin/stations/e2e-records");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^e2e-records-\d{4}-\d{2}-\d{2}\.lastradio\.json$/);
    const file = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
    expect(file).toMatchObject({ format: "the-last-radio.station", station: { slug: "e2e-records", name: "E2E Records" } });
    expect(file.plays.length).toBeGreaterThan(0);
  });

  test("Importing a station", async ({ page }, info) => {
    const exported = await page.request.get("/api/radios/e2e-records/export");
    const path = info.outputPath("station.lastradio.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, await exported.body());
    const source = await exported.json();

    await page.goto("/admin");
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a station" });
    await dialog.getByLabel("Station file").setInputFiles(path);
    await expect(dialog.getByText("E2E Records", { exact: true })).toBeVisible();
    await expect(dialog.getByText(new RegExp(`${source.songs.length} songs?`))).toBeVisible();
    await expect(dialog.getByLabel("Address")).toHaveValue("e2e-records-2"); // the file's own is taken
    await dialog.getByLabel("Name").fill("Imported Records");
    await dialog.getByRole("button", { name: "Import" }).click();

    await expect(page.getByText("Imported Records imported")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/stations\/e2e-records-2$/);
    await expect(page.getByRole("heading", { name: "Imported Records" })).toBeVisible();
    const [a, b] = await Promise.all(
      ["e2e-records", "e2e-records-2"].map(async (s) => (await (await page.request.get(`/api/radios/${s}/songs?pageSize=100`)).json()).total),
    );
    expect(b).toBe(a);
    // Keep the rest of the suite's stations as they were.
    await page.request.patch("/api/radios/e2e-records-2", { data: { isActive: false } });
  });
});
