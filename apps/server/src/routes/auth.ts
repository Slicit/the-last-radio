import { Hono } from "hono";
import { zValidator } from "../lib/validate.js";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import {
  type AppEnv,
  endSession,
  hashPassword,
  startSession,
  toPublicUser,
  verifyPassword,
} from "../lib/auth.js";

const email = z.string().trim().toLowerCase().email().max(254);

const registerBody = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  displayName: z.string().trim().min(2).max(40),
});

const loginBody = z.object({ email, password: z.string().min(1).max(200) });

// Spend the same argon2 time on unknown emails so login timing doesn't reveal accounts.
const DUMMY_HASH = hashPassword("not-a-real-password");

export const authRoutes = new Hono<AppEnv>()
  .post("/register", zValidator("json", registerBody), async (c) => {
    const body = c.req.valid("json");
    const passwordHash = await hashPassword(body.password);

    const user = await db.transaction(async (tx) => {
      // Serialize registrations so exactly one "first user" becomes admin.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lastradio:register'))`);
      const existing = await tx.query.users.findFirst({ where: eq(schema.users.email, body.email) });
      if (existing) throw new HTTPException(409, { message: "That email is already registered" });
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.users);
      const [created] = await tx
        .insert(schema.users)
        .values({
          email: body.email,
          displayName: body.displayName,
          passwordHash,
          role: count === 0 ? "admin" : "player",
        })
        .returning();
      return created;
    });

    await startSession(c, user.id);
    return c.json({ user: toPublicUser(user) }, 201);
  })

  .post("/login", zValidator("json", loginBody), async (c) => {
    const { email, password } = c.req.valid("json");
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : (await verifyPassword(await DUMMY_HASH, password), false);
    if (!user || !ok) throw new HTTPException(401, { message: "Wrong email or password" });
    await startSession(c, user.id);
    return c.json({ user: toPublicUser(user) });
  })

  .post("/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  })

  .get("/me", (c) => c.json({ user: c.get("user") }));
