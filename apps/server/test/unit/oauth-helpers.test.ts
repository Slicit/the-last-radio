import { describe, expect, it } from "vitest";
import { acceptableRedirect, parseScopes, pkceS256, redirectMatches } from "../../src/lib/oauth-helpers.js";

// specs/features/connect-your-ai.feature: "OAuth is strict"
describe("OAuth is strict", () => {
  it("redirects must be https, or http to the user's own machine", () => {
    expect(acceptableRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(acceptableRedirect("http://localhost:6274/oauth/callback")).toBe(true);
    expect(acceptableRedirect("http://127.0.0.1:33418/callback")).toBe(true);
    expect(acceptableRedirect("http://evil.example/cb")).toBe(false);
    expect(acceptableRedirect("https://ok.example/cb#frag")).toBe(false);
    expect(acceptableRedirect("javascript:alert(1)")).toBe(false);
  });

  it("loopback redirects may use any port; everything else must match exactly", () => {
    const registered = ["http://127.0.0.1:33418/callback", "https://app.example/cb"];
    expect(redirectMatches(registered, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectMatches(registered, "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectMatches(registered, "https://app.example/cb")).toBe(true);
    expect(redirectMatches(registered, "https://app.example/cb2")).toBe(false);
    expect(redirectMatches(registered, "https://evil.example/cb")).toBe(false);
  });

  it("scopes default to everything and must all exist", () => {
    expect(parseScopes(undefined)).toEqual(["radio:read", "radio:write"]);
    expect(parseScopes("radio:read")).toEqual(["radio:read"]);
    expect(parseScopes("radio:read admin")).toBeNull();
  });

  it("PKCE S256 is base64url(sha256(verifier)), unpadded", () => {
    // Expected value computed independently:
    // printf %s "$VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '='
    expect(pkceS256("dBjftJeZ4CVP-mJ92K5hU-UuK2IgrfeHgV8R-PZxTjL")).toBe("uBpoouIyXnUEv5eB7rkDrAp4l8h9gvXWGevULJZcHvU");
  });
});
