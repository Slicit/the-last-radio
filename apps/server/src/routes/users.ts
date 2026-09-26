import { Hono } from "hono";
import { zValidator } from "../lib/validate.js";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, requireAdmin } from "../lib/auth.js";

const { users, queueItems } = schema;

export const userRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .get("/", async (c) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        pushes: sql<number>`count(${queueItems.id})::int`,
        plays: sql<number>`count(${queueItems.startedAt})::int`,
      })
      .from(users)
      .leftJoin(queueItems, eq(queueItems.userId, users.id))
      .groupBy(users.id)
      .orderBy(asc(users.createdAt));
    return c.json({ users: rows });
  })
  .patch("/:id", zValidator("json", z.object({ role: z.enum(["admin", "player"]) })), async (c) => {
    const id = c.req.param("id");
    if (id === c.get("user")!.id) throw new HTTPException(400, { message: "You can't change your own role" });
    const [u] = await db
      .update(users)
      .set({ role: c.req.valid("json").role })
      .where(eq(users.id, id))
      .returning({ id: users.id, role: users.role });
    if (!u) throw new HTTPException(404, { message: "No such user" });
    return c.json({ user: u });
  });

