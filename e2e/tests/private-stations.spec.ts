import { expect, test } from "./fixtures";
import { asAdmin } from "./fixtures";

const MAILPIT = process.env.MAILPIT_URL ?? "http://lastradio-test-mailpit:8025";

/** The confirmation link from the latest email to `to`, read back from Mailpit. */
async function confirmationLink(request: import("@playwright/test").APIRequestContext, to: string) {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const list = await (await request.get(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(to)}`)).json();
      const id = list.messages?.[0]?.ID;
      if (!id) return undefined;
      const msg = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
      link = String(msg.Text).match(/https?:\/\/\S+\/verify-email\?token=[\w-]+/)?.[0];
      // The HTML version carries the same link behind a button.
      if (link) expect(String(msg.HTML)).toContain(`href="${link}"`);
      return link;
    }, { timeout: 20_000 })
    .toBeTruthy();
  return link!;
}

// specs/features/private-stations.feature
test("Letting a whole email domain in", async ({ page, browser, request }) => {
  // Admin: a private station open to @verified-e2e.test
  const admin = await (await browser.newContext(asAdmin)).newPage();
  await admin.request.post("/api/radios", { data: { slug: "e2e-private", name: "E2E Private", isPrivate: true, autofillBelowSec: 0 } });
  const dom = await admin.request.post("/api/radios/e2e-private/domains", { data: { domain: "verified-e2e.test" } });
  expect(dom.ok()).toBe(true);

  // A newcomer from that domain signs up: the station stays hidden until they confirm.
  const email = `vera-${Date.now()}@verified-e2e.test`;
  await page.goto("/register");
  await page.fill("#displayName", "Vera");
  await page.fill("#email", email);
  await page.fill("#password", "vera-password-e2e");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: /Vera/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "E2E Private" })).toHaveCount(0);

  const link = await confirmationLink(request, email);
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByText("Email confirmed")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "E2E Private" })).toBeVisible();
});

test("A private station is invisible to everyone else", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "E2E Private" })).toHaveCount(0);
  await page.goto("/r/e2e-private");
  await expect(page.getByText(/No station called/)).toBeVisible();
  const hls = await page.request.get("/hls/e2e-private/index.m3u8");
  expect(hls.status()).toBe(403);
});

test.describe(() => {
  test.use(asAdmin);

  test("Managing who may listen from the station editor", async ({ page }) => {
    // Regression 2026-09-26: the domain's "Add" was a form inside the editor's form, so it saved the station instead.
    // Unique per run, so a retry starts clean.
    const run = Date.now().toString(36);
    const team = `team-${run}.test`;
    const second = `second-${run}.test`;
    await page.request.post("/api/radios", { data: { slug: "e2e-access", name: "E2E Access", isPrivate: true, autofillBelowSec: 0 } });
    await page.goto("/admin/stations/e2e-access");
    const domains = page.getByRole("group", { name: "Email domains" });
    await domains.getByRole("textbox").fill(`@${team.toUpperCase()}`);
    await domains.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(`@${team} added`)).toBeVisible();
    await expect(page.getByText("Nobody at this domain has an account yet").first()).toBeVisible();
    expect((await (await page.request.get("/api/radios/e2e-access/access")).json()).domains).toContain(team);
    await expect(page.getByText("Unsaved changes")).toBeHidden();

    // Enter works too, and never saves the station around it.
    await domains.getByRole("textbox").fill(second);
    await domains.getByRole("textbox").press("Enter");
    await expect(page.getByText(`@${second} added`)).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").getByText("Saved", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: `Remove ${team}` }).click();
    await expect(page.getByText(`@${team} removed`)).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove ${team}` })).toHaveCount(0);
    expect((await (await page.request.get("/api/radios/e2e-access/access")).json()).domains).toEqual(expect.arrayContaining([second]));
  });
});

test("A banner reminds people to confirm their email", async ({ page, request }) => {
  const email = `wendy-${Date.now()}@banner-e2e.test`;
  await page.goto("/register");
  await page.fill("#displayName", "Wendy");
  await page.fill("#email", email);
  await page.fill("#password", "wendy-password-e2e");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  const banner = page.getByRole("region", { name: "Confirm your email" });
  await expect(banner).toContainText(`Confirm your email, ${email}`);
  await banner.getByRole("button", { name: "Send confirmation email" }).click();
  await expect(banner).toContainText(`Sent! Open the link we emailed to ${email}`);
  await banner.getByRole("button", { name: "Hide" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload(); // hidden for this visit only
  await expect(page.getByRole("region", { name: "Confirm your email" })).toBeVisible();

  // Once confirmed, it's gone for good.
  const link = await confirmationLink(request, email);
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByText("Email confirmed")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Wendy/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Confirm your email" })).toHaveCount(0);
});
