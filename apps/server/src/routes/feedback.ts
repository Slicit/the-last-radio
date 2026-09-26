import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, requireAdmin, requireUser } from "../lib/auth.js";
import { rateLimit } from "../lib/rate-limit.js";
import { zValidator } from "../lib/validate.js";
import { offsetOf, pageOf, pagingQuery } from "../lib/paging.js";

const { feedback, feedbackVotes, users } = schema;

export const FEEDBACK_PER_DAY = 3;
const DAY_MS = 24 * 3600_000;

export const postBody = z.object({
  kind: z.enum(["idea", "bug", "other"]).default("idea"),
  body: z.string().trim().min(10, "Tell us a bit more (10 characters at least)").max(2000),
});

/** How many they can still send, and when the next one frees up (rolling 24 h). */
async function allowance(userId: string, tx: Pick<typeof db, "select"> = db) {
  const recent = await tx
    .select({ createdAt: feedback.createdAt })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), gt(feedback.createdAt, new Date(Date.now() - DAY_MS))))
    .orderBy(feedback.createdAt);
  const remaining = Math.max(0, FEEDBACK_PER_DAY - recent.length);
  const nextAt = remaining === 0 ? new Date(recent[recent.length - FEEDBACK_PER_DAY].createdAt.getTime() + DAY_MS) : null;
  return { limit: FEEDBACK_PER_DAY, remaining, nextAt: nextAt?.toISOString() ?? null };
}

/** Listeners: send feedback and follow what happened to it. */
export const feedbackRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/mine", async (c) => {
    const user = c.get("user")!;
    const items = await db
      .select({
        id: feedback.id,
        kind: feedback.kind,
        body: feedback.body,
        createdAt: feedback.createdAt,
        read: isNotNull(feedback.readAt),
        archived: isNotNull(feedback.archivedAt),
      })
      .from(feedback)
      .where(eq(feedback.userId, user.id))
      .orderBy(desc(feedback.createdAt))
      .limit(20);
    return c.json({ items, allowance: await allowance(user.id) });
  })
  .post(
    "/",
    // Belt and braces against scripted spam from one place, on top of the per-account limit.
    rateLimit({ limit: 10, windowMs: DAY_MS, message: "Too much feedback from here today." }),
    zValidator("json", postBody),
    async (c) => {
      const user = c.get("user")!;
      const { kind, body } = c.req.valid("json");
      const created = await db.transaction(async (tx) => {
        // Serialize per user so parallel posts can't slip past the daily limit.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`feedback:${user.id}`}))`);
        const a = await allowance(user.id, tx);
        if (a.remaining === 0) {
          const hrs = Math.max(1, Math.ceil((Date.parse(a.nextAt!) - Date.now()) / 3600_000));
          throw new HTTPException(429, {
            message: `You've sent ${FEEDBACK_PER_DAY} messages today, thank you! You can send another in ~${hrs} h.`,
          });
        }
        const [row] = await tx.insert(feedback).values({ userId: user.id, kind, body }).returning({ id: feedback.id });
        return row;
      });
      return c.json({ id: created.id, allowance: await allowance(user.id) }, 201);
    },
  );

const score = sql<number>`coalesce((select sum(v.value) from feedback_votes v where v.feedback_id = ${feedback.id}), 0)::int`;

/** Admins: triage inbox. */
export const adminFeedbackRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .get(
    "/",
    zValidator(
      "query",
      pagingQuery.extend({ view: z.enum(["inbox", "archived"]).default("inbox"), sort: z.enum(["new", "top"]).default("new") }),
    ),
    async (c) => {
      const q = c.req.valid("query");
      const { view, sort } = q;
      const inView = view === "inbox" ? isNull(feedback.archivedAt) : isNotNull(feedback.archivedAt);
      const me = c.get("user")!.id;
      const items = await db
        .select({
          id: feedback.id,
          kind: feedback.kind,
          body: feedback.body,
          createdAt: feedback.createdAt,
          read: isNotNull(feedback.readAt),
          archived: isNotNull(feedback.archivedAt),
          author: { id: users.id, displayName: users.displayName, email: users.email },
          score,
          myVote: sql<number>`coalesce((select v.value from feedback_votes v where v.feedback_id = ${feedback.id} and v.user_id = ${me}), 0)::int`,
        })
        .from(feedback)
        .innerJoin(users, eq(users.id, feedback.userId))
        .where(inView)
        .orderBy(...(sort === "top" ? [desc(score), desc(feedback.createdAt)] : [desc(feedback.createdAt)]))
        .limit(q.pageSize)
        .offset(offsetOf(q));
      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(feedback).where(inView);
      const [{ unread }] = await db
        .select({ unread: sql<number>`count(*)::int` })
        .from(feedback)
        .where(and(isNull(feedback.readAt), isNull(feedback.archivedAt)));
      return c.json({ ...pageOf(items, total, q), unread });
    },
  )
  .patch("/:id", zValidator("json", z.object({ read: z.boolean().optional(), archived: z.boolean().optional() })), async (c) => {
    const { read, archived } = c.req.valid("json");
    const set: Partial<typeof feedback.$inferInsert> = {};
    if (read !== undefined) set.readAt = read ? new Date() : null;
    // Archiving implies it's been looked at.
    if (archived !== undefined) {
      set.archivedAt = archived ? new Date() : null;
      if (archived && read === undefined) set.readAt = sql`coalesce(${feedback.readAt}, now())` as unknown as Date;
    }
    if (!Object.keys(set).length) return c.json({ ok: true });
    const res = await db.update(feedback).set(set).where(eq(feedback.id, c.req.param("id"))).returning({ id: feedback.id });
    if (!res.length) throw new HTTPException(404, { message: "No such feedback" });
    return c.json({ ok: true });
  })
  .post("/:id/vote", zValidator("json", z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) })), async (c) => {
    const id = c.req.param("id");
    const me = c.get("user")!.id;
    const { value } = c.req.valid("json");
    const exists = await db.query.feedback.findFirst({ where: eq(feedback.id, id), columns: { id: true } });
    if (!exists) throw new HTTPException(404, { message: "No such feedback" });
    if (value === 0) {
      await db.delete(feedbackVotes).where(and(eq(feedbackVotes.feedbackId, id), eq(feedbackVotes.userId, me)));
    } else {
      await db
        .insert(feedbackVotes)
        .values({ feedbackId: id, userId: me, value })
        .onConflictDoUpdate({ target: [feedbackVotes.feedbackId, feedbackVotes.userId], set: { value } });
    }
    const [{ total }] = await db
      .select({ total: sql<number>`coalesce(sum(${feedbackVotes.value}), 0)::int` })
      .from(feedbackVotes)
      .where(eq(feedbackVotes.feedbackId, id));
    return c.json({ score: total, myVote: value });
  });
