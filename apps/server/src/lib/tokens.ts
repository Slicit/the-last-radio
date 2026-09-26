import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { User } from "../db/schema.js";

const { apiTokens, users } = schema;

import { isScope, type Scope } from "./scopes.js";
export { isScope, SCOPES, type Scope } from "./scopes.js";

export const ACCESS_TTL_SEC = 3600;
const REFRESH_TTL_MS = 60 * 24 * 3600_000;

type Kind = "api_key" | "oauth_access" | "oauth_refresh";
const PREFIX: Record<Kind, string> = { api_key: "lr_key_", oauth_access: "lr_at_", oauth_refresh: "lr_rt_" };

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

async function mint(
  kind: Kind,
  userId: string,
  scopes: Scope[],
  opts: { name?: string; clientId?: string; expiresAt?: Date } = {},
) {
  const token = PREFIX[kind] + randomToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      kind,
      tokenHash: sha256(token),
      prefix: token.slice(0, PREFIX[kind].length + 4),
      name: opts.name,
      clientId: opts.clientId,
      scopes,
      expiresAt: opts.expiresAt,
    })
    .returning();
  return { token, row };
}

export const createApiKey = (userId: string, name: string, scopes: Scope[]) => mint("api_key", userId, scopes, { name });

export async function issueOAuthTokens(userId: string, clientId: string, scopes: Scope[]) {
  const access = await mint("oauth_access", userId, scopes, {
    clientId,
    expiresAt: new Date(Date.now() + ACCESS_TTL_SEC * 1000),
  });
  const refresh = await mint("oauth_refresh", userId, scopes, {
    clientId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return {
    access_token: access.token,
    token_type: "Bearer" as const,
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh.token,
    scope: scopes.join(" "),
  };
}

const live = (hash: string) =>
  and(
    eq(apiTokens.tokenHash, hash),
    isNull(apiTokens.revokedAt),
    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
  );

export type BearerAuth = { user: User; scopes: Scope[]; kind: "api_key" | "oauth"; tokenId: string };

/** Resolves an API key or OAuth access token. Refresh tokens are not accepted here. */
export async function resolveBearer(token: string): Promise<BearerAuth | null> {
  if (!token.startsWith(PREFIX.api_key) && !token.startsWith(PREFIX.oauth_access)) return null;
  const [row] = await db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(live(sha256(token)))
    .limit(1);
  if (!row || row.token.kind === "oauth_refresh") return null;
  // Record usage, at most once a minute per token.
  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, row.token.id),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, new Date(Date.now() - 60_000))),
      ),
    )
    .catch(() => {});
  return {
    user: row.user,
    scopes: row.token.scopes.filter(isScope),
    kind: row.token.kind === "api_key" ? "api_key" : "oauth",
    tokenId: row.token.id,
  };
}

/** Refresh-token grant: the old refresh token is spent and a new pair issued. */
export async function rotateRefreshToken(refreshToken: string, clientId: string) {
  const [old] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(live(sha256(refreshToken)), eq(apiTokens.kind, "oauth_refresh"), eq(apiTokens.clientId, clientId)))
    .returning();
  if (!old) {
    // A refresh token that was already spent is being replayed: someone has a
    // copy. Revoke everything this grant holds so neither party keeps access.
    const [spent] = await db
      .select({ userId: apiTokens.userId })
      .from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, sha256(refreshToken)), eq(apiTokens.kind, "oauth_refresh")))
      .limit(1);
    if (spent) {
      await db
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiTokens.userId, spent.userId), eq(apiTokens.clientId, clientId), isNull(apiTokens.revokedAt)));
    }
    return null;
  }
  return issueOAuthTokens(old.userId, clientId, old.scopes.filter(isScope));
}

/** RFC 7009: revoking an unknown token is not an error. */
export async function revokeToken(token: string) {
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.tokenHash, sha256(token)));
}
