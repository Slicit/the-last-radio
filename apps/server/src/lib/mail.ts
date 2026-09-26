import nodemailer, { type Transporter } from "nodemailer";

/** Email needs SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) and MAIL_FROM. */
export const mailConfigured = () => !!process.env.SMTP_URL || process.env.MAIL_CAPTURE === "1";

type Mail = { to: string; subject: string; text: string };
/** In integration tests (MAIL_CAPTURE=1) mail is kept here instead of sent. */
export const capturedMail: Mail[] = [];

let transport: Transporter | null = null;

export async function sendMail(mail: Mail) {
  if (process.env.MAIL_CAPTURE === "1") {
    capturedMail.push(mail);
    return;
  }
  if (!process.env.SMTP_URL) throw new Error("SMTP_URL is not set");
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.MAIL_FROM || "The Last Radio <no-reply@localhost>", ...mail });
}
