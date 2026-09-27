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
import { POLICY_VERSION } from "../lib/legal.js";
import { RateLimiter, rateLimit, tooMany } from "../lib/rate-limit.js";
import { confirmVerification, sendVerification } from "../lib/verify-email.js";
import { getSettings } from "../lib/settings.js";
import { publicUrl } from "../lib/public-url.js";

const email = z.string().trim().toLowerCase().email().max(254);

export const registerBody = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  displayName: z.string().trim().min(2).max(40),
  acceptPrivacy: z.literal(true, { message: "Please read and acknowledge the privacy notice" }),
});

export const loginBody = z.object({ email, password: z.string().min(1).max(200) });

// Spend the same argon2 time on unknown emails so login timing doesn't reveal accounts.
const DUMMY_HASH = hashPassword("not-a-real-password");

// Password guessing: a few failures per account, and a cap per IP across accounts.
const failedLogins = new RateLimiter(5, 15 * 60_000);
const loginsPerIp = rateLimit({ limit: 30, windowMs: 15 * 60_000, message: "Too many sign-in attempts." });
const registrationsPerIp = rateLimit({
  limit: Number(process.env.REGISTRATIONS_PER_HOUR ?? 5),
  windowMs: 3600_000,
  message: "Too many new accounts from here.",
});

export const authRoutes = new Hono<AppEnv>()
  .post("/register", registrationsPerIp, zValidator("json", registerBody), async (c) => {
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
          privacyAckVersion: POLICY_VERSION,
          privacyAckAt: new Date(),
          role: count === 0 ? "admin" : "player",
          // New accounts start in the theme the admins chose for the radio.
          theme: (await getSettings()).defaultTheme,
        })
        .returning();
      return created;
    });

    await startSession(c, user.id);
    // Best effort: a mail hiccup mustn't block signing up; they can resend from their profile.
    await sendVerification(user, publicUrl(c)).catch((e) => console.error("verification mail:", e));
    return c.json({ user: toPublicUser(user) }, 201);
  })

  .post("/login", loginsPerIp, zValidator("json", loginBody), async (c) => {
    const { email, password } = c.req.valid("json");
    const locked = failedLogins.blocked(email);
    if (locked) tooMany(c, locked, "Too many wrong passwords for this account.");
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : (await verifyPassword(await DUMMY_HASH, password), false);
    if (!user || !ok) {
      failedLogins.hit(email);
      throw new HTTPException(401, { message: "Wrong email or password" });
    }
    failedLogins.reset(email);
    await startSession(c, user.id);
    return c.json({ user: toPublicUser(user) });
  })

  .post("/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  })

  .get("/me", (c) => c.json({ user: c.get("user") }))

  // The link from the verification email (may be opened on another device, signed out).
  .post(
    "/verify-email",
    rateLimit({ limit: 20, windowMs: 3600_000, message: "Too many attempts." }),
    zValidator("json", z.object({ token: z.string().min(20).max(100) })),
    async (c) => {
      if (!(await confirmVerification(c.req.valid("json").token))) {
        throw new HTTPException(400, { message: "That link is invalid or has expired. Send a new one from your profile." });
      }
      return c.json({ ok: true });
    },
  );
