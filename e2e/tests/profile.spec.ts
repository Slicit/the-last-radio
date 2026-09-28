import { asAdmin, asPlayer, expect, test } from "./fixtures";
import { PLAYER } from "../global-setup";
import { deflateSync } from "node:zlib";

// A tiny valid PNG, built by hand so the test needs no image library.
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x7a)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// specs/features/profile.feature
test.use(asPlayer);
const menu = (page: import("@playwright/test").Page) => page.getByRole("button", { name: new RegExp(PLAYER.displayName) });

test("Choosing a theme", async ({ page, browser }) => {
  await page.goto("/");
  await menu(page).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Manrope");
  // The menu stays open while trying themes.
  await page.getByRole("menuitemradio", { name: "Vintage" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "vintage");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Fraunces");
  await page.keyboard.press("Escape");
  // Another device (a fresh browser, same account) gets it too.
  const other = await (await browser.newContext(asPlayer)).newPage();
  await other.goto("/");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "vintage");
  // Back to Night.
  await menu(page).click();
  await page.getByRole("menuitemradio", { name: "Night" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.keyboard.press("Escape");
});

test("Setting a profile photo", async ({ page }) => {
  await page.goto("/");
  await menu(page).click();
  await page.getByRole("menuitem", { name: "Edit profile" }).click();
  await page.getByLabel("Profile photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png(120, 80) });
  await expect(page.getByText("Photo updated")).toBeVisible();
  await expect(page.locator('header img[src^="/api/avatars/"]')).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.locator('header img[src^="/api/avatars/"]')).toHaveCount(0);
});

test("The radio's default theme", async ({ browser }) => {
  const admin = await (await browser.newContext(asAdmin)).newPage();
  try {
    await admin.goto("/admin/settings");
    const choice = admin.getByRole("radiogroup", { name: "Default theme" });
    await choice.getByRole("radio", { name: /Vintage/ }).click();
    await expect(admin.getByText("Default theme: Vintage")).toBeVisible();
    await expect(choice.getByRole("radio", { name: /Vintage/ })).toHaveAttribute("aria-checked", "true");

    // A signed-out visitor sees it (a fresh browser, nothing stored).
    const guest = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
    await guest.goto("/");
    await expect(guest.locator("html")).toHaveAttribute("data-theme", "vintage");
  } finally {
    // Leave the radio as the other tests expect it.
    await admin.request.patch("/api/admin/settings", { data: { defaultTheme: "night" } });
  }
});
