import { asPlayer, expect, test } from "./fixtures";

// specs/features/connect-your-ai.feature
test.use(asPlayer);

test("Creating an API key", async ({ page }) => {
  await page.goto("/connect");
  await expect(page.getByRole("heading", { name: "Connect your AI" })).toBeVisible();
  await expect(page.locator("input[readonly]").first()).toHaveValue(/\/mcp$/);
  await page.getByLabel("Name").fill("E2E laptop");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("Copy it now: you won't be able to see it again.")).toBeVisible();
  const token = await page.locator("input[readonly]").filter({ hasText: "" }).evaluateAll((els) =>
    (els as HTMLInputElement[]).map((e) => e.value).find((v) => v.startsWith("lr_key_")),
  );
  expect(token).toMatch(/^lr_key_/);
  // The key works on the API right away.
  const res = await page.request.get("/api/radios", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  await page.getByRole("button", { name: "I've saved it" }).click();
  await expect(page.getByText(token!)).toHaveCount(0);
  await expect(page.getByText("E2E laptop")).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "E2E laptop" }).getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Key revoked")).toBeVisible();
});

test("The consent page", async ({ page }) => {
  const reg = await page.request.post("/api/oauth/register", {
    data: { client_name: "E2E Assistant", redirect_uris: ["http://127.0.0.1:47000/callback"] },
  });
  const { client_id } = await reg.json();
  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: "http://127.0.0.1:47000/callback",
    code_challenge: "uBpoouIyXnUEv5eB7rkDrAp4l8h9gvXWGevULJZcHvU",
    code_challenge_method: "S256",
    state: "e2e-state",
  });
  // The assistant's callback isn't running: capture where we're sent instead.
  let landed = "";
  await page.route("http://127.0.0.1:47000/**", (route) => {
    landed = route.request().url();
    return route.fulfill({ body: "ok" });
  });

  await page.goto(`/oauth/authorize?${params}`);
  await expect(page.getByText("E2E Assistant wants to connect")).toBeVisible();
  await expect(page.getByText("It will act as Sam Player")).toBeVisible();
  await expect(page.getByText("Add songs, downvote and skip your own songs")).toBeVisible();
  await expect(page.getByText("127.0.0.1:47000")).toBeVisible();
  await page.getByRole("button", { name: "Deny" }).click();
  await expect.poll(() => landed).toContain("error=access_denied");
  await page.waitForURL(/127\.0\.0\.1:47000/); // let that redirect finish before navigating again

  landed = "";
  await page.goto(`/oauth/authorize?${params}`);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => landed).toMatch(/[?&]code=[^&]+.*state=e2e-state|state=e2e-state.*[?&]code=/);
});

test("Exploring the API without MCP", async ({ page }) => {
  await page.goto("/");
  expect(await page.locator('link[rel="service-desc"]').getAttribute("href")).toBe("/api/openapi.json");
  await page.getByRole("link", { name: "Developers & API" }).click();
  await expect(page.getByRole("heading", { name: "Developers" })).toBeVisible();
  await page.getByRole("button", { name: /post\s*\/api\/radios\/\{slug\}\/queue/i }).click();
  await expect(page.getByText(/Body · application\/json/)).toBeVisible();
  const spec = await (await page.request.get("/api/openapi.json")).json();
  expect(spec.openapi).toBe("3.1.0");
});
