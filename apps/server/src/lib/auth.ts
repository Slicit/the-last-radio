import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { db, schema } from "../db/index.js";
import type { User } from "../db/schema.js";
import { env } from "./env.js";
import { publicUrl } from "./public-url.js";
import { resolveBearer, type Scope } from "./tokens.js";
import { POLICY_VERSION } from "./legal.js";

export const SESSION_COOKIE = "lr_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export type PublicUser = Pick<User, "id" | "email" | "displayName" | "role" | "theme"> & {
  avatarUrl: string | null;
  /** True when they haven't acknowledged the current privacy notice. */
  privacyAckRequired: boolean;
  emailVerified: boolean;
};

/** How the request authenticated: a browser session can do everything its user can; tokens only their scopes. */
export type AuthContext = { kind: "session" } | { kind: "api_key" | "oauth"; scopes: Scope[]; tokenId: string };
export type AppEnv = { Variables: { user: PublicUser | null; auth: AuthContext | null } };

export { hashPassword, verifyPassword } from "./password.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const avatarUrl = (id: string, updatedAt: Date | null) =>
  updatedAt ? `/api/avatars/${id}?v=${updatedAt.getTime()}` : null;

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    theme: u.theme,
    avatarUrl: avatarUrl(u.id, u.avatarUpdatedAt),
    privacyAckRequired: u.privacyAckVersion !== POLICY_VERSION,
    emailVerified: !!u.emailVerifiedAt,
  };
}

export async function startSession(c: Context, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id: hashToken(token), userId, expiresAt });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Points OAuth-capable clients (MCP) at our metadata when a bearer token is refused. */
export function bearerChallenge(c: Context, error?: string) {
  const meta = `${publicUrl(c)}/.well-known/oauth-protected-resource`;
  c.header("WWW-Authenticate", `Bearer resource_metadata="${meta}"${error ? `, error="${error}"` : ""}`);
}

/**
 * Resolves who is calling into `c.get("user")` / `c.get("auth")`: a bearer
 * token (API key or OAuth access token) or the browser session cookie. A bad
 * bearer token is refused outright; no credentials at all just means anonymous.
 */
export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
  c.set("auth", null);
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const bearer = await resolveBearer(header.slice(7).trim());
    if (!bearer) {
      bearerChallenge(c, "invalid_token");
      throw new HTTPException(401, { message: "That API key or token is invalid, expired or revoked" });
    }
    c.set("user", toPublicUser(bearer.user));
    c.set("auth", { kind: bearer.kind, scopes: bearer.scopes, tokenId: bearer.tokenId });
    return next();
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const rows = await db
      .select({ user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(
        and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date())),
      )
      .limit(1);
    if (rows[0]) {
      c.set("user", toPublicUser(rows[0].user));
      c.set("auth", { kind: "session" });
    }
  }
  await next();
});

/** Signed in, and (for tokens) granted `scope`. */
export const requireScope = (scope: Scope) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get("auth");
    if (auth && auth.kind !== "session" && !auth.scopes.includes(scope)) {
      throw new HTTPException(403, { message: `This key doesn't allow that (needs ${scope})` });
    }
    // Reading is open to everyone; writing needs an account.
    if (scope !== "radio:read" && !c.get("user")) throw new HTTPException(401, { message: "Sign in first" });
    await next();
  });

/** Account management (keys, connected apps) only from a signed-in browser. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw new HTTPException(401, { message: "Sign in first" });
  if (c.get("auth")?.kind !== "session") throw new HTTPException(403, { message: "Do this from the website" });
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw new HTTPException(401, { message: "Sign in first" });
  await next();
});

// Admin actions stay in the browser: API keys and AI clients never get them.
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "Sign in first" });
  if (user.role !== "admin") throw new HTTPException(403, { message: "Admins only" });
  if (c.get("auth")?.kind !== "session") throw new HTTPException(403, { message: "Admin actions need the website" });
  await next();
});

export async function purgeExpiredSessions() {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}
