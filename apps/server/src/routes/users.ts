import { Hono } from "hono";
import { zValidator } from "../lib/validate.js";
import { z } from "zod";
import { and, asc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, requireAdmin } from "../lib/auth.js";
import { offsetOf, pageOf, pagingQuery } from "../lib/paging.js";

const { users, queueItems } = schema;

export const usersQuery = pagingQuery.extend({
  // Name or email contains this.
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "admins", "unconfirmed", "former"]).default("all"),
});

function userFilters(q: z.infer<typeof usersQuery>): SQL[] {
  const out: SQL[] = [];
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, "\\$&")}%`;
    out.push(or(ilike(users.displayName, like), ilike(users.email, like))!);
  }
  if (q.filter === "former") out.push(isNotNull(users.deletedAt));
  else out.push(isNull(users.deletedAt)); // former listeners and placeholders only when asked for
  if (q.filter === "admins") out.push(eq(users.role, "admin"));
  if (q.filter === "unconfirmed") out.push(isNull(users.emailVerifiedAt));
  return out;
}

export const userPatch = z.object({
  role: z.enum(["admin", "player"]).optional(),
  emailVerified: z.boolean().optional(),
  excludeFromStats: z.boolean().optional(),
});

export const userRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .get("/", zValidator("query", usersQuery), async (c) => {
    const q = c.req.valid("query");
    const where = and(...userFilters(q));
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`,
        excludeFromStats: users.excludeFromStats,
        createdAt: users.createdAt,
        pushes: sql<number>`count(${queueItems.id})::int`,
        plays: sql<number>`count(${queueItems.startedAt})::int`,
      })
      .from(users)
      .leftJoin(queueItems, eq(queueItems.userId, users.id))
      .where(where)
      .groupBy(users.id)
      .orderBy(asc(users.createdAt))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return c.json({ ...pageOf(rows, total, q), users: rows });
  })
  .patch("/:id", zValidator("json", userPatch), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (body.role && id === c.get("user")!.id) throw new HTTPException(400, { message: "You can't change your own role" });
    const [u] = await db
      .update(users)
      .set({
        ...(body.role ? { role: body.role } : {}),
        // An admin vouching for someone's address (e.g. when email isn't set up).
        ...(body.emailVerified !== undefined ? { emailVerifiedAt: body.emailVerified ? new Date() : null } : {}),
        // Leave someone out of statistics (a test account, an admin trying things).
        ...(body.excludeFromStats !== undefined ? { excludeFromStats: body.excludeFromStats } : {}),
      })
      .where(eq(users.id, id))
      .returning({ id: users.id, role: users.role, excludeFromStats: users.excludeFromStats });
    if (!u) throw new HTTPException(404, { message: "No such user" });
    return c.json({ user: u });
  });

