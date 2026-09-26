import { expect, test } from "./fixtures";

// specs/features/security.feature
test("Pages can't be framed or sniffed", async ({ page }) => {
  for (const path of ["/", "/oauth/authorize?client_id=x"]) {
    const res = await page.goto(path);
    const h = res!.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  }
});

test("Large requests are refused with a readable error", async ({ request }) => {
  const res = await request.post("/api/auth/login", { data: { email: "a@b.c", password: "x".repeat(70_000) } });
  expect(res.status()).toBe(413);
  expect((await res.json()).error).toBe("That request is too large");
});
