// OAuth 2.1 for AI clients (MCP): authorization code + PKCE (S256) with
// public clients created by dynamic client registration (RFC 7591), refresh
// token rotation, revocation (RFC 7009), and the discovery documents MCP
// clients look for (RFC 8414, RFC 9728). The consent screen is the web app's
// /oauth/authorize page, which talks to /api/oauth/authorize.
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, requireSession } from "../lib/auth.js";
import { publicUrl } from "../lib/public-url.js";
import { zValidator } from "../lib/validate.js";
import { rateLimit } from "../lib/rate-limit.js";
import { acceptableRedirect, parseScopes, pkceS256, redirectMatches } from "../lib/oauth-helpers.js";
import {
  createApiKey,
  isScope,
  issueOAuthTokens,
  randomToken,
  revokeToken,
  rotateRefreshToken,
  SCOPES,
  sha256,
  type Scope,
} from "../lib/tokens.js";

const { oauthClients, oauthCodes, apiTokens } = schema;
const CODE_TTL_MS = 10 * 60_000;
const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

// ---------------------------------------------------------------- discovery

export const wellKnownRoutes = new Hono<AppEnv>()
  .use(cors())
  // RFC 9728; also served under the resource path, which some clients try first.
  .get("/oauth-protected-resource/*", (c) => c.json(protectedResource(c)))
  .get("/oauth-protected-resource", (c) => c.json(protectedResource(c)))
  .get("/oauth-authorization-server", (c) => c.json(authServer(c)))
  .get("/oauth-authorization-server/*", (c) => c.json(authServer(c)));

function protectedResource(c: Context) {
  const base = publicUrl(c);
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "The Last Radio",
  };
}

function authServer(c: Context) {
  const base = publicUrl(c);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ALL_SCOPES,
  };
}

// ---------------------------------------------------------------- helpers

function oauthError(c: Context, status: 400 | 401, error: string, description: string) {
  return c.json({ error, error_description: description }, status);
}

async function formOrJson(c: Context): Promise<Record<string, string>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) return (await c.req.json().catch(() => ({}))) as Record<string, string>;
  const body = await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]));
}

const authorizeParams = z.object({
  response_type: z.literal("code", { message: "Only response_type=code is supported" }),
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256", { message: "Only PKCE with S256 is supported" }),
  scope: z.string().max(500).optional(),
  state: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});
type AuthorizeParams = z.infer<typeof authorizeParams>;

/** Checks an authorization request; returns the client and scopes, or a message for the consent page. */
async function checkAuthorize(p: AuthorizeParams) {
  const client = await db.query.oauthClients.findFirst({ where: eq(oauthClients.id, p.client_id) });
  if (!client) throw new HTTPException(400, { message: "This app isn't registered with The Last Radio" });
  if (!redirectMatches(client.redirectUris, p.redirect_uri)) {
    throw new HTTPException(400, { message: "This app asked to send you somewhere it didn't register" });
  }
  const scopes = parseScopes(p.scope);
  if (!scopes) throw new HTTPException(400, { message: "This app asked for permissions that don't exist" });
  return { client, scopes };
}

function redirectWith(uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

// ---------------------------------------------------------------- endpoints

export const registerBody = z.object({
  client_name: z.string().trim().max(100).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

export const oauthRoutes = new Hono<AppEnv>()
  // Machine-to-machine endpoints are called cross-origin by browser-based clients.
  .use("/register", cors())
  .use("/token", cors())
  .use("/revoke", cors())
  .use("/register", rateLimit({ limit: 10, windowMs: 3600_000, message: "Too many app registrations from here." }))
  .use("/token", rateLimit({ limit: 60, windowMs: 60_000, message: "Too many token requests." }))
  .use("/revoke", rateLimit({ limit: 60, windowMs: 60_000 }))

  // RFC 7591 dynamic client registration (public clients only).
  .post("/register", async (c) => {
    const parsed = registerBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_client_metadata", error_description: "Bad registration" }, 400);
    const body = parsed.data;
    const bad = body.redirect_uris.find((u) => !acceptableRedirect(u));
    if (bad) {
      return c.json(
        { error: "invalid_redirect_uri", error_description: `Redirects must be https or loopback http: ${bad}` },
        400,
      );
    }
    const [client] = await db
      .insert(oauthClients)
      .values({ id: `lrc_${randomToken(18)}`, name: body.client_name || "An AI app", redirectUris: body.redirect_uris })
      .returning();
    return c.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      },
      201,
    );
  })

  // Consent page: who is asking, for what.
  .get("/authorize", requireSession, zValidator("query", authorizeParams), async (c) => {
    const { client, scopes } = await checkAuthorize(c.req.valid("query"));
    return c.json({
      client: { id: client.id, name: client.name, redirectHost: new URL(c.req.valid("query").redirect_uri).host },
      scopes: scopes.map((s) => ({ scope: s, description: SCOPES[s] })),
    });
  })

  // The user's decision; the page then navigates to `redirectTo`.
  .post(
    "/authorize",
    requireSession,
    rateLimit({ limit: 30, windowMs: 60_000, key: (c) => c.get("user")?.id ?? null }),
    zValidator("json", authorizeParams.extend({ approve: z.boolean() })),
    async (c) => {
      const p = c.req.valid("json");
      const { client, scopes } = await checkAuthorize(p);
      if (!p.approve) {
        return c.json({ redirectTo: redirectWith(p.redirect_uri, { error: "access_denied", state: p.state }) });
      }
      const code = randomToken();
      await db.insert(oauthCodes).values({
        codeHash: sha256(code),
        clientId: client.id,
        userId: c.get("user")!.id,
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        scopes,
        resource: p.resource,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      return c.json({ redirectTo: redirectWith(p.redirect_uri, { code, state: p.state, iss: publicUrl(c) }) });
    },
  )

  .post("/token", async (c) => {
    c.header("Cache-Control", "no-store");
    const b = await formOrJson(c);
    if (!b.client_id) return oauthError(c, 401, "invalid_client", "client_id is required");

    if (b.grant_type === "authorization_code") {
      if (!b.code || !b.code_verifier || !b.redirect_uri) {
        return oauthError(c, 400, "invalid_request", "code, code_verifier and redirect_uri are required");
      }
      // Codes are single use: delete on first sight, valid or not.
      const [row] = await db.delete(oauthCodes).where(eq(oauthCodes.codeHash, sha256(b.code))).returning();
      if (!row || row.expiresAt < new Date()) return oauthError(c, 400, "invalid_grant", "Code is invalid or expired");
      if (row.clientId !== b.client_id) return oauthError(c, 400, "invalid_grant", "Code was issued to another client");
      if (row.redirectUri !== b.redirect_uri) return oauthError(c, 400, "invalid_grant", "redirect_uri mismatch");
      if (pkceS256(b.code_verifier) !== row.codeChallenge) {
        return oauthError(c, 400, "invalid_grant", "PKCE verification failed");
      }
      return c.json(await issueOAuthTokens(row.userId, row.clientId, row.scopes.filter(isScope)));
    }

    if (b.grant_type === "refresh_token") {
      if (!b.refresh_token) return oauthError(c, 400, "invalid_request", "refresh_token is required");
      const tokens = await rotateRefreshToken(b.refresh_token, b.client_id);
      if (!tokens) return oauthError(c, 400, "invalid_grant", "Refresh token is invalid, expired or revoked");
      return c.json(tokens);
    }

    return oauthError(c, 400, "unsupported_grant_type", "Use authorization_code or refresh_token");
  })

  .post("/revoke", async (c) => {
    const b = await formOrJson(c);
    if (b.token) await revokeToken(b.token);
    return c.body(null, 200);
  });

// ---------------------------------------------------------------- the user's own access

export const keyBody = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(ALL_SCOPES as [Scope, ...Scope[]])).min(1),
});

/** API keys and connected apps, managed from the website. */
export const accessRoutes = new Hono<AppEnv>()
  .use(requireSession)
  .get("/", async (c) => {
    const user = c.get("user")!;
    const rows = await db
      .select({ token: apiTokens, clientName: oauthClients.name })
      .from(apiTokens)
      .leftJoin(oauthClients, eq(oauthClients.id, apiTokens.clientId))
      .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)));
    const now = new Date();
    const keys = rows
      .filter((r) => r.token.kind === "api_key")
      .map(({ token: t }) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        scopes: t.scopes,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
      }));
    // One entry per app: it's connected while it holds a usable refresh token.
    const apps = new Map<string, { clientId: string; name: string; scopes: string[]; connectedAt: Date; lastUsedAt: Date | null }>();
    for (const { token: t, clientName } of rows) {
      if (!t.clientId || (t.expiresAt && t.expiresAt < now)) continue;
      const app = apps.get(t.clientId) ?? {
        clientId: t.clientId,
        name: clientName ?? "An AI app",
        scopes: t.scopes,
        connectedAt: t.createdAt,
        lastUsedAt: null,
      };
      if (t.createdAt < app.connectedAt) app.connectedAt = t.createdAt;
      if (t.lastUsedAt && (!app.lastUsedAt || t.lastUsedAt > app.lastUsedAt)) app.lastUsedAt = t.lastUsedAt;
      apps.set(t.clientId, app);
    }
    return c.json({ keys, apps: [...apps.values()] });
  })
  .post("/keys", zValidator("json", keyBody), async (c) => {
    const { name, scopes } = c.req.valid("json");
    const { token, row } = await createApiKey(c.get("user")!.id, name, scopes);
    // The only time the full key is ever shown.
    return c.json({ token, key: { id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes } }, 201);
  })
  .delete("/keys/:id", async (c) => {
    await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, c.req.param("id")), eq(apiTokens.userId, c.get("user")!.id), eq(apiTokens.kind, "api_key")));
    return c.json({ ok: true });
  })
  .delete("/apps/:clientId", async (c) => {
    await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.clientId, c.req.param("clientId")), eq(apiTokens.userId, c.get("user")!.id)));
    return c.json({ ok: true });
  });
