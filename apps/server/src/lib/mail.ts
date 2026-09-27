import nodemailer, { type Transporter } from "nodemailer";

/**
 * Email needs SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465, or
 * smtp://postfix:587 for the relay in deploy/mail) and MAIL_FROM.
 */
export const mailConfigured = () => !!process.env.SMTP_URL || process.env.MAIL_CAPTURE === "1";

type Mail = {
  to: string;
  subject: string;
  /** Always sent: the plain-text version every mail app can show. */
  text: string;
  html?: string;
  /** Inline images the HTML refers to as cid:… */
  attachments?: { filename: string; content: Buffer; cid: string; contentType: string }[];
};

/**
 * At most `limit` emails to the same address within `blockMs`; the one that
 * reaches the limit blocks the address for `blockMs`. Guards people's inboxes whoever asks (a
 * sign-up typed with someone else's address, repeated "resend" clicks).
 * In memory: there is one api process.
 */
export class RecipientLimiter {
  private sent = new Map<string, number[]>();
  private blockedUntil = new Map<string, number>();

  constructor(
    readonly limit = 3,
    readonly blockMs = 30 * 60_000,
  ) {}

  private key = (to: string) => to.trim().toLowerCase();

  /** Seconds until `to` may receive mail again; 0 when it may now. */
  wait(to: string, now = Date.now()): number {
    const until = this.blockedUntil.get(this.key(to)) ?? 0;
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  }

  /** Counts an email; the one that reaches the limit starts the block. */
  record(to: string, now = Date.now()) {
    const key = this.key(to);
    const times = [...(this.sent.get(key) ?? []).filter((t) => now - t < this.blockMs), now];
    if (times.length >= this.limit) {
      this.blockedUntil.set(key, now + this.blockMs);
      this.sent.delete(key);
    } else {
      this.sent.set(key, times);
    }
    if (this.sent.size + this.blockedUntil.size > 50_000) this.sweep(now);
  }

  reset() {
    this.sent.clear();
    this.blockedUntil.clear();
  }

  private sweep(now: number) {
    for (const [k, t] of this.sent) if (t.every((x) => now - x >= this.blockMs)) this.sent.delete(k);
    for (const [k, u] of this.blockedUntil) if (u <= now) this.blockedUntil.delete(k);
  }
}

export const recipientLimiter = new RecipientLimiter();

export class MailRateLimited extends Error {
  constructor(readonly retryAfterSec: number) {
    super(`We've sent several emails to this address already. Try again in ${Math.max(1, Math.ceil(retryAfterSec / 60))} min.`);
  }
}
/** In integration tests (MAIL_CAPTURE=1) mail is kept here instead of sent. */
export const capturedMail: Mail[] = [];

let transport: Transporter | null = null;

export async function sendMail(mail: Mail) {
  const wait = recipientLimiter.wait(mail.to);
  if (wait) throw new MailRateLimited(wait);
  recipientLimiter.record(mail.to);
  if (process.env.MAIL_CAPTURE === "1") {
    capturedMail.push(mail);
    return;
  }
  if (!process.env.SMTP_URL) throw new Error("SMTP_URL is not set");
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  const from = process.env.MAIL_FROM || "The Last Radio <no-reply@localhost>";
  // MAIL_RETURN_PATH: where bounces go (the envelope sender, checked by SPF). Defaults to the From address.
  const returnPath = process.env.MAIL_RETURN_PATH;
  await transport.sendMail({ from, ...(returnPath ? { envelope: { from: returnPath, to: mail.to } } : {}), ...mail });
}
