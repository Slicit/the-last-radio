import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { randomToken, sha256 } from "./tokens.js";
import { MailRateLimited, mailConfigured, recipientLimiter, sendMail } from "./mail.js";
import { confirmationEmail } from "./emails.js";

const { emailTokens, users } = schema;
const TTL_MS = 24 * 3600_000;

/** Emails a one-time link proving they own the address. Returns false when mail isn't set up. */
export async function sendVerification(user: { id: string; email: string; displayName: string }, baseUrl: string) {
  if (!mailConfigured()) return false;
  // Checked before making a link nobody will receive (sendMail checks again).
  const wait = recipientLimiter.wait(user.email);
  if (wait) throw new MailRateLimited(wait);
  const token = randomToken();
  await db.delete(emailTokens).where(lt(emailTokens.expiresAt, new Date()));
  await db.insert(emailTokens).values({ tokenHash: sha256(token), userId: user.id, email: user.email, expiresAt: new Date(Date.now() + TTL_MS) });
  const link = `${baseUrl}/verify-email?token=${token}`;
  await sendMail({ to: user.email, ...confirmationEmail({ name: user.displayName, email: user.email, link, baseUrl }) });
  return true;
}

/** Marks the address verified if the token is valid, unused, and the email hasn't changed since. */
export async function confirmVerification(token: string): Promise<boolean> {
  const [row] = await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.tokenHash, sha256(token)), gt(emailTokens.expiresAt, new Date())))
    .returning();
  if (!row) return false;
  const res = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, row.userId), eq(users.email, row.email)))
    .returning({ id: users.id });
  return res.length > 0;
}
