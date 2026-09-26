import { and, eq, exists, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import type { PublicUser } from "./auth.js";

const { radios, radioMembers, radioDomains } = schema;

/** The part after @, for verified addresses only: unverified emails prove nothing. */
export const verifiedDomain = (u: PublicUser | null) =>
  u?.emailVerified ? u.email.slice(u.email.lastIndexOf("@") + 1).toLowerCase() : null;

/**
 * SQL condition: `radios` rows this person may see. Public stations for all;
 * private ones for admins, members, and verified emails whose domain the
 * station lists.
 */
export function visibleTo(user: PublicUser | null): SQL | undefined {
  if (user?.role === "admin") return undefined;
  const member = user
    ? exists(db.select({ one: sql`1` }).from(radioMembers).where(and(eq(radioMembers.radioId, radios.id), eq(radioMembers.userId, user.id))))
    : sql`false`;
  const domain = verifiedDomain(user);
  const byDomain = domain
    ? exists(db.select({ one: sql`1` }).from(radioDomains).where(and(eq(radioDomains.radioId, radios.id), eq(radioDomains.domain, domain))))
    : sql`false`;
  return or(eq(radios.isPrivate, false), member, byDomain);
}

export async function canAccess(radio: Radio, user: PublicUser | null): Promise<boolean> {
  if (!radio.isPrivate || user?.role === "admin") return true;
  if (!user) return false;
  const [row] = await db.select({ id: radios.id }).from(radios).where(and(eq(radios.id, radio.id), visibleTo(user))).limit(1);
  return !!row;
}
