import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, lt } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { db, schema } from "../db/index.js";
import type { User } from "../db/schema.js";
import { env } from "./env.js";

export const SESSION_COOKIE = "lr_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export type PublicUser = Pick<User, "id" | "email" | "displayName" | "role">;
export type AppEnv = { Variables: { user: PublicUser | null } };

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) =>
  verify(passwordHash, password);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role };
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

/** Resolves the session cookie (if any) into `c.get("user")`. Never rejects. */
export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
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
    if (rows[0]) c.set("user", toPublicUser(rows[0].user));
  }
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw new HTTPException(401, { message: "Sign in first" });
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "Sign in first" });
  if (user.role !== "admin") throw new HTTPException(403, { message: "Admins only" });
  await next();
});

export async function purgeExpiredSessions() {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}
