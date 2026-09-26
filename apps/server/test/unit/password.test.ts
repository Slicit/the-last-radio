import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password.js";

// specs/features/accounts.feature: "Passwords are stored salted and hashed"
describe("Passwords are stored salted and hashed", () => {
  it("uses argon2id with the OWASP baseline parameters", async () => {
    expect(await hashPassword("correct horse battery")).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  });

  it("salts every hash differently", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
    expect(a.split("$")[4]).not.toBe(b.split("$")[4]);
  });

  it("verifies the right password only, and never throws on garbage", async () => {
    const h = await hashPassword("s3cret-pass");
    expect(await verifyPassword(h, "s3cret-pass")).toBe(true);
    expect(await verifyPassword(h, "s3cret-Pass")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});
