import { ADMIN, PLAYER } from "../global-setup";
import { expect, test } from "./fixtures";

// specs/features/accounts.feature
test("The first account becomes the admin", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", ADMIN.email);
  await page.fill("#password", ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
});

test("Signing in and out", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", PLAYER.email);
  await page.fill("#password", PLAYER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: new RegExp(PLAYER.displayName) })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(PLAYER.displayName) }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Join" })).toBeVisible();
});

test("Signing in from a page returns you to it", async ({ page }) => {
  await page.goto("/r/e2e-main");
  const card = page.getByText("Sign in to add songs to this station.").locator("..");
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.fill("#email", PLAYER.email);
  await page.fill("#password", PLAYER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/r\/e2e-main$/);
});

test("a wrong password is explained", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", PLAYER.email);
  await page.fill("#password", "definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong email or password")).toBeVisible();
});
