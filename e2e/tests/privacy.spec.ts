import { request as pwRequest } from "@playwright/test";
import { asPlayer, expect, test } from "./fixtures";

// specs/features/privacy.feature
test("Reading the privacy notice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy & cookies" }).click();
  await page.getByRole("radio", { name: "Français" }).click();
  await expect(page.getByRole("heading", { name: "Confidentialité et cookies" })).toBeVisible();
  await expect(page.getByText(/Dernière mise à jour/)).toBeVisible();
  for (const s of ["lr_session", "lr_theme", "lr_listener", "CNIL"]) await expect(page.getByText(s).first()).toBeVisible();
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Privacy and cookies" })).toBeVisible();
});

test("Acknowledging the notice when signing up", async ({ page }) => {
  await page.goto("/register");
  await page.fill("#displayName", "New Listener");
  await page.fill("#email", `new-${Date.now()}@e2e.test`);
  await page.fill("#password", "new-listener-password");
  await page.getByRole("button", { name: "Create account" }).click();
  // The required checkbox blocks the form until ticked.
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /New Listener/ })).toBeVisible();
});

test("Acknowledging a new or changed notice when signing in", async ({ page, baseURL }) => {
  // A fresh account whose acknowledgement is outdated.
  const email = `stale-${Date.now()}@e2e.test`;
  const api = await pwRequest.newContext({ baseURL });
  const reg = await api.post("/api/auth/register", { data: { email, password: "stale-password-1", displayName: "Stale", acceptPrivacy: true } });
  expect(reg.status(), await reg.text()).toBe(201);
  await api.dispose();
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql`update users set privacy_ack_version = '2020-01-01' where email = ${email}`;
  await sql.end();

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "stale-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Before you continue")).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the notice" })).toBeVisible();
  await page.getByRole("button", { name: "I've read it, continue" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe(() => {
  test.use(asPlayer);
  test("Downloading my data", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Sam Player/ }).click();
    await page.getByRole("menuitem", { name: "Edit profile" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download my data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("the-last-radio-my-data.json");
  });
});

test("Deleting my account", async ({ page, baseURL }) => {
  const email = `leaving-${Date.now()}@e2e.test`;
  const api = await pwRequest.newContext({ baseURL });
  const reg = await api.post("/api/auth/register", { data: { email, password: "leaving-password", displayName: "Leaving Soon", acceptPrivacy: true } });
  expect(reg.status(), await reg.text()).toBe(201);
  await api.dispose();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "leaving-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Leaving Soon/ }).click();
  await page.getByRole("menuitem", { name: "Edit profile" }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByLabel("Confirm with your password").fill("leaving-password");
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(page.getByText("Your account was deleted. Thanks for listening.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
