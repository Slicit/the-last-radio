import { describe, expect, it } from "vitest";
import { app, call } from "./helpers.js";
import { documentedRoutes } from "../../src/lib/openapi.js";

// specs/features/connect-your-ai.feature: "Exploring the API without MCP"
describe("Exploring the API without MCP", () => {
  it("serves an OpenAPI 3.1 document", async () => {
    const r = await call("GET", "/api/openapi.json");
    expect(r.status).toBe(200);
    expect(r.json.openapi).toBe("3.1.0");
    expect(r.json.servers[0].url).toBe("http://radio.test");
    const pushBody = r.json.paths["/api/radios/{slug}/queue"].post.requestBody.content["application/json"].schema;
    expect(JSON.stringify(pushBody)).toContain("trackId"); // generated from the route's own validator
  });

  it("documents every API route", () => {
    const internal = /^\/api\/internal\/|^\/\.well-known\/|^\/mcp/;
    const actual = new Set(
      app.routes
        .filter((r) => r.method !== "ALL" && !internal.test(r.path))
        .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
    );
    const documented = new Set(documentedRoutes());
    const missing = [...actual].filter((k) => !documented.has(k));
    const stale = [...documented].filter((k) => !actual.has(k));
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });
});
