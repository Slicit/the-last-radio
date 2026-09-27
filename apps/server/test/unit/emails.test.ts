import { afterEach, describe, expect, it } from "vitest";
import { confirmationEmail } from "../../src/lib/emails.js";

const base = { name: "Sam", email: "sam@example.com", link: "https://radio.example.com/verify-email?token=abc123", baseUrl: "https://radio.example.com" };

// specs/features/private-stations.feature: "Confirming an email"
describe("the confirmation email", () => {
  afterEach(() => {
    delete process.env.PRIVACY_CONTROLLER;
    delete process.env.PRIVACY_CONTACT;
  });

  it("comes as HTML with a button, and as plain text", () => {
    const m = confirmationEmail(base);
    expect(m.subject).toBe("Confirm your email for The Last Radio");
    expect(m.html).toContain(`href="${base.link}"`);
    expect(m.html).toContain(">Confirm my email</a>");
    expect(m.html).toContain('src="cid:logo@thelastradio"');
    expect(m.attachments).toEqual([expect.objectContaining({ cid: "logo@thelastradio", contentType: "image/png" })]);
    expect(m.attachments[0].content.subarray(1, 4).toString()).toBe("PNG");
    expect(m.text).toContain(base.link);
    expect(m.text).toContain("works once, for 24 hours");
  });

  it("ends with who sent it, why, and the privacy notice", () => {
    process.env.PRIVACY_CONTROLLER = "Example Org";
    process.env.PRIVACY_CONTACT = "privacy@example.com";
    const m = confirmationEmail(base);
    for (const part of [m.html, m.text]) {
      expect(part).toContain("https://radio.example.com/privacy");
      expect(part).toContain("If that wasn't you, ignore this email");
      expect(part).toContain("Example Org");
    }
    expect(m.html).toContain('href="mailto:privacy@example.com"');
  });

  it("never lets a display name write HTML", () => {
    const m = confirmationEmail({ ...base, name: '<img src=x onerror="alert(1)">' });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
