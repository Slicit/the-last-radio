import { Hono } from "hono";
import { zValidator } from "../lib/validate.js";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, requireAdmin } from "../lib/auth.js";
import { offsetOf, pageOf, pagingQuery } from "../lib/paging.js";

const { users, queueItems } = schema;

export const userRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .get("/", zValidator("query", pagingQuery), async (c) => {
    const q = c.req.valid("query");
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users);
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        emailVerified: sql<boolean>`${users.emailVerifiedAt} is not null`,
        createdAt: users.createdAt,
        pushes: sql<number>`count(${queueItems.id})::int`,
        plays: sql<number>`count(${queueItems.startedAt})::int`,
      })
      .from(users)
      .leftJoin(queueItems, eq(queueItems.userId, users.id))
      .groupBy(users.id)
      .orderBy(asc(users.createdAt))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return c.json({ ...pageOf(rows, total, q), users: rows });
  })
  .patch("/:id", zValidator("json", z.object({ role: z.enum(["admin", "player"]).optional(), emailVerified: z.boolean().optional() })), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (body.role && id === c.get("user")!.id) throw new HTTPException(400, { message: "You can't change your own role" });
    const [u] = await db
      .update(users)
      .set({
        ...(body.role ? { role: body.role } : {}),
        // An admin vouching for someone's address (e.g. when email isn't set up).
        ...(body.emailVerified !== undefined ? { emailVerifiedAt: body.emailVerified ? new Date() : null } : {}),
      })
      .where(eq(users.id, id))
      .returning({ id: users.id, role: users.role });
    if (!u) throw new HTTPException(404, { message: "No such user" });
    return c.json({ user: u });
  });

