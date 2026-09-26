import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type AppEnv, bearerChallenge } from "../lib/auth.js";
import { publicUrl } from "../lib/public-url.js";
import { clientIp, rateLimit } from "../lib/rate-limit.js";
import { buildMcpServer } from "../mcp/server.js";

// Streamable HTTP, stateless: every request carries its bearer token and gets
// a fresh server bound to that user, so there is no session state to lose.
export const mcpRoutes = new Hono<AppEnv>()
  .use(
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"],
      exposeHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    }),
  )
  // Per token: an assistant stuck in a loop can't hammer the station (or yt-dlp).
  .use(rateLimit({ limit: 120, windowMs: 60_000, message: "Too many requests from this assistant.", key: (c) => {
    const auth = c.get("auth");
    return auth && auth.kind !== "session" ? auth.tokenId : clientIp(c);
  } }))
  .all("/", async (c) => {
    const auth = c.get("auth");
    // Bearer tokens only: a browser cookie must never drive the MCP endpoint.
    if (!auth || auth.kind === "session") {
      bearerChallenge(c);
      return c.json({ error: "Connect with an API key or sign in with OAuth" }, 401);
    }
    const server = buildMcpServer({ user: c.get("user")!, scopes: auth.scopes, baseUrl: publicUrl(c) });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
