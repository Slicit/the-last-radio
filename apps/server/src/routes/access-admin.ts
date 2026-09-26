import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, requireAdmin } from "../lib/auth.js";
import { mailConfigured } from "../lib/mail.js";
import { zValidator } from "../lib/validate.js";
import * as svc from "../services/radio.js";

const { radioMembers, radioDomains, users } = schema;

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/^\*?@/, "")) // accept "@acme.test" and "*@acme.test"
  .pipe(z.string().regex(/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Use a domain like acme.test"));

/** Admins: who may hear a private station. */
export const stationAccessRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .get("/:slug/access", async (c) => {
    const radio = await svc.getRadio(c.req.param("slug"));
    const [members, domains] = await Promise.all([
      db
        .select({ id: users.id, displayName: users.displayName, email: users.email, addedAt: radioMembers.addedAt })
        .from(radioMembers)
        .innerJoin(users, eq(users.id, radioMembers.userId))
        .where(eq(radioMembers.radioId, radio.id))
        .orderBy(asc(users.displayName)),
      db.select({ domain: radioDomains.domain }).from(radioDomains).where(eq(radioDomains.radioId, radio.id)).orderBy(asc(radioDomains.domain)),
    ]);
    return c.json({ isPrivate: radio.isPrivate, members, domains: domains.map((d) => d.domain), mailConfigured: mailConfigured() });
  })
  .post("/:slug/members", zValidator("json", z.object({ email: z.string().trim().toLowerCase().email() })), async (c) => {
    const radio = await svc.getRadio(c.req.param("slug"));
    const u = await db.query.users.findFirst({ where: eq(users.email, c.req.valid("json").email) });
    if (!u || u.deletedAt) throw new HTTPException(404, { message: "Nobody has an account with that email yet" });
    await db.insert(radioMembers).values({ radioId: radio.id, userId: u.id }).onConflictDoNothing();
    return c.json({ ok: true, member: { id: u.id, displayName: u.displayName, email: u.email } }, 201);
  })
  .delete("/:slug/members/:userId", async (c) => {
    const radio = await svc.getRadio(c.req.param("slug"));
    await db.delete(radioMembers).where(and(eq(radioMembers.radioId, radio.id), eq(radioMembers.userId, c.req.param("userId"))));
    return c.json({ ok: true });
  })
  .post("/:slug/domains", zValidator("json", z.object({ domain: domainSchema })), async (c) => {
    const radio = await svc.getRadio(c.req.param("slug"));
    const { domain } = c.req.valid("json");
    await db.insert(radioDomains).values({ radioId: radio.id, domain }).onConflictDoNothing();
    return c.json({ ok: true, domain }, 201);
  })
  .delete("/:slug/domains/:domain", async (c) => {
    const radio = await svc.getRadio(c.req.param("slug"));
    await db.delete(radioDomains).where(and(eq(radioDomains.radioId, radio.id), eq(radioDomains.domain, c.req.param("domain").toLowerCase())));
    return c.json({ ok: true });
  });
