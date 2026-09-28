import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, endSession, requireSession, toPublicUser, verifyPassword } from "../lib/auth.js";
import { POLICY_VERSION } from "../lib/legal.js";
import { sendVerification } from "../lib/verify-email.js";
import { MailRateLimited } from "../lib/mail.js";
import { publicUrl } from "../lib/public-url.js";
import { AVATAR_MAX_BYTES, processAvatar } from "../lib/avatar.js";
import { rateLimit } from "../lib/rate-limit.js";
import { zValidator } from "../lib/validate.js";
import { THEMES } from "../lib/settings.js";

const { users, avatars, sessions, apiTokens, oauthCodes, oauthClients, feedback, feedbackVotes, queueItems, tracks, radios, skipVotes, radioMembers, emailTokens, songUpvotes } = schema;
export { THEMES };

const perUser = (limit: number, windowMs: number, message: string) =>
  rateLimit({ limit, windowMs, message, key: (c) => c.get("user")?.id ?? null });

/** The signed-in person's own profile, from the website only. */
export const meRoutes = new Hono<AppEnv>()
  .use(requireSession)
  .patch(
    "/",
    perUser(30, 60_000, "Too many profile changes."),
    zValidator(
      "json",
      z.object({ displayName: z.string().trim().min(2).max(40).optional(), theme: z.enum(THEMES).optional() }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const [u] = await db.update(users).set(body).where(eq(users.id, c.get("user")!.id)).returning();
      return c.json({ user: toPublicUser(u) });
    },
  )
  .put(
    "/avatar",
    perUser(10, 3600_000, "Too many photo changes."),
    // Just over 5 MB of image plus multipart framing; the image itself is checked below.
    bodyLimit({
      maxSize: AVATAR_MAX_BYTES + 64 * 1024,
      onError: (c) => c.json({ error: "That image is over 5 MB" }, 413),
    }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => null);
      const file = form?.file;
      if (!(file instanceof File)) throw new HTTPException(400, { message: "Choose an image to upload" });
      if (file.size > AVATAR_MAX_BYTES) throw new HTTPException(413, { message: "That image is over 5 MB" });
      const image = await processAvatar(Buffer.from(await file.arrayBuffer()));
      const now = new Date();
      const userId = c.get("user")!.id;
      await db.transaction(async (tx) => {
        await tx
          .insert(avatars)
          .values({ userId, image, updatedAt: now })
          .onConflictDoUpdate({ target: avatars.userId, set: { image, updatedAt: now } });
        await tx.update(users).set({ avatarUpdatedAt: now }).where(eq(users.id, userId));
      });
      const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
      return c.json({ user: toPublicUser(u!) });
    },
  )
  .post("/privacy-ack", zValidator("json", z.object({ version: z.string().max(20) })), async (c) => {
    if (c.req.valid("json").version !== POLICY_VERSION) {
      throw new HTTPException(409, { message: "The privacy notice changed again: please reload and read the latest version" });
    }
    const [u] = await db
      .update(users)
      .set({ privacyAckVersion: POLICY_VERSION, privacyAckAt: new Date() })
      .where(eq(users.id, c.get("user")!.id))
      .returning();
    return c.json({ user: toPublicUser(u) });
  })

  // Limited per address by the mailer: 3 emails, then 30 minutes' rest.
  .post("/verify-email", async (c) => {
    const me = (await db.query.users.findFirst({ where: eq(users.id, c.get("user")!.id) }))!;
    if (me.emailVerifiedAt) return c.json({ ok: true, alreadyVerified: true });
    const sent = await sendVerification(me, publicUrl(c)).catch((e) => {
      if (e instanceof MailRateLimited) {
        c.header("Retry-After", String(e.retryAfterSec));
        throw new HTTPException(429, { message: e.message });
      }
      throw e;
    });
    if (!sent) throw new HTTPException(503, { message: "Email isn't set up on this radio yet. Ask an admin to verify you." });
    return c.json({ ok: true });
  })

  // Right of access and portability (GDPR art. 15 and 20): everything we hold about you.
  .get("/export", perUser(5, 3600_000, "Too many exports."), async (c) => {
    const id = c.get("user")!.id;
    const [me] = await db.select().from(users).where(eq(users.id, id));
    const [songs, votes, notes, keys, memberships, upvoted] = await Promise.all([
      db
        .select({
          station: radios.slug,
          title: tracks.title,
          link: tracks.sourceUrl,
          status: queueItems.status,
          addedAt: queueItems.createdAt,
          startedAt: queueItems.startedAt,
        })
        .from(queueItems)
        .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
        .innerJoin(radios, eq(radios.id, queueItems.radioId))
        .where(eq(queueItems.userId, id))
        .orderBy(desc(queueItems.createdAt)),
      db
        .select({ title: tracks.title, votedAt: skipVotes.createdAt })
        .from(skipVotes)
        .innerJoin(queueItems, eq(queueItems.id, skipVotes.queueItemId))
        .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
        .where(eq(skipVotes.userId, id)),
      db.select({ kind: feedback.kind, message: feedback.body, sentAt: feedback.createdAt }).from(feedback).where(eq(feedback.userId, id)),
      db
        .select({ kind: apiTokens.kind, name: apiTokens.name, app: oauthClients.name, scopes: apiTokens.scopes, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt })
        .from(apiTokens)
        .leftJoin(oauthClients, eq(oauthClients.id, apiTokens.clientId))
        .where(eq(apiTokens.userId, id)),
      db
        .select({ station: radios.slug, addedAt: radioMembers.addedAt })
        .from(radioMembers)
        .innerJoin(radios, eq(radios.id, radioMembers.radioId))
        .where(eq(radioMembers.userId, id)),
      db
        .select({ station: radios.slug, title: tracks.title, upvotedAt: songUpvotes.createdAt })
        .from(songUpvotes)
        .innerJoin(radios, eq(radios.id, songUpvotes.radioId))
        .innerJoin(tracks, eq(tracks.id, songUpvotes.trackId))
        .where(eq(songUpvotes.userId, id)),
    ]);
    const data = {
      exportedAt: new Date().toISOString(),
      account: {
        email: me.email,
        displayName: me.displayName,
        role: me.role,
        theme: me.theme,
        hasProfilePhoto: !!me.avatarUpdatedAt,
        emailVerifiedAt: me.emailVerifiedAt,
        leftOutOfStatistics: me.excludeFromStats,
        createdAt: me.createdAt,
        privacyNoticeAcknowledged: { version: me.privacyAckVersion, at: me.privacyAckAt },
      },
      privateStations: memberships,
      songsAdded: songs,
      downvotes: votes,
      upvotes: upvoted,
      feedback: notes,
      apiAccess: keys,
      note: "Passwords, session cookies and API keys are stored only as one-way hashes and can't be exported.",
    };
    c.header("Content-Disposition", 'attachment; filename="the-last-radio-my-data.json"');
    return c.json(data);
  })

  // Right to erasure (GDPR art. 17). The account row stays, anonymised, so the
  // stations' history and stats remain consistent; everything personal goes.
  .delete(
    "/",
    perUser(5, 3600_000, "Too many attempts."),
    zValidator("json", z.object({ password: z.string().min(1).max(200) })),
    async (c) => {
      const id = c.get("user")!.id;
      const me = await db.query.users.findFirst({ where: eq(users.id, id) });
      if (!me || !(await verifyPassword(me.passwordHash, c.req.valid("json").password))) {
        throw new HTTPException(403, { message: "That password isn't right" });
      }
      if (me.role === "admin") {
        const others = await db.query.users.findFirst({ where: and(eq(users.role, "admin"), ne(users.id, id)) });
        if (!others) throw new HTTPException(409, { message: "You're the only admin. Make someone else admin first." });
      }
      await db.transaction(async (tx) => {
        await tx.delete(sessions).where(eq(sessions.userId, id));
        await tx.delete(apiTokens).where(eq(apiTokens.userId, id));
        await tx.delete(oauthCodes).where(eq(oauthCodes.userId, id));
        await tx.delete(avatars).where(eq(avatars.userId, id));
        await tx.delete(feedbackVotes).where(eq(feedbackVotes.userId, id));
        await tx.delete(feedback).where(eq(feedback.userId, id));
        await tx.delete(radioMembers).where(eq(radioMembers.userId, id));
        await tx.delete(emailTokens).where(eq(emailTokens.userId, id));
        await tx
          .update(users)
          .set({
            email: `deleted-${id}@deleted.invalid`,
            displayName: "Former listener",
            passwordHash: "!",
            role: "player",
            theme: "night",
            avatarUpdatedAt: null,
            privacyAckVersion: null,
            privacyAckAt: null,
            emailVerifiedAt: null,
            deletedAt: new Date(),
          })
          .where(eq(users.id, id));
      });
      await endSession(c);
      return c.json({ ok: true });
    },
  )

  .delete("/avatar", async (c) => {
    const userId = c.get("user")!.id;
    await db.delete(avatars).where(eq(avatars.userId, userId));
    const [u] = await db.update(users).set({ avatarUpdatedAt: null }).where(eq(users.id, userId)).returning();
    return c.json({ user: toPublicUser(u) });
  });

/** Public avatar images: only ever our own re-encoded WebP, served inertly. */
export const avatarRoutes = new Hono<AppEnv>().get("/:userId", async (c) => {
  const id = c.req.param("userId");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HTTPException(404, { message: "No avatar" });
  const row = await db.query.avatars.findFirst({ where: eq(avatars.userId, id) });
  if (!row) throw new HTTPException(404, { message: "No avatar" });
  const etag = `"${row.updatedAt.getTime()}"`;
  const headers = {
    "Content-Type": "image/webp",
    // URLs carry ?v=<updatedAt>, so a given URL never changes.
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": "inline",
  };
  if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
  return c.body(new Uint8Array(row.image), 200, headers);
});
