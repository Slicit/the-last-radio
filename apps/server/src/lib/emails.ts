import { EMAIL_LOGO_PNG } from "./email-logo.js";
import { legalInfo } from "./legal.js";

export type Email = {
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; cid: string; contentType: string }[];
};

const LOGO_CID = "logo@thelastradio";
const BRAND = "#e7000b";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Who runs this radio and how to reach them, as the privacy notice says (or a fallback). */
function footer(baseUrl: string) {
  const { controller, contact } = legalInfo();
  const privacy = `${baseUrl}/privacy`;
  const host = new URL(baseUrl).host;
  const contactHref = contact && (contact.includes("@") && !contact.includes("://") ? `mailto:${contact}` : contact);
  return {
    text: [
      `You're receiving this because this address was used to sign up at The Last Radio (${host}).`,
      "If that wasn't you, ignore this email: nothing is confirmed unless the link is clicked.",
      `What we keep about you, why, and your rights (access, correction, deletion): ${privacy}`,
      controller || contact ? `Run by ${[controller, contact].filter(Boolean).join(", ")}.` : null,
      "This is an automated message.",
    ]
      .filter(Boolean)
      .join("\n"),
    html: `
      You're receiving this because this address was used to sign up at The Last Radio
      (<a href="${esc(baseUrl)}" style="color:#6b6b6b">${esc(host)}</a>).
      If that wasn't you, ignore this email: nothing is confirmed unless the link is clicked.<br><br>
      What we keep about you, why, and your rights (access, correction, deletion):
      <a href="${esc(privacy)}" style="color:#6b6b6b">privacy notice</a>.<br>
      ${controller || contact ? `Run by ${[controller && esc(controller), contact && `<a href="${esc(contactHref!)}" style="color:#6b6b6b">${esc(contact)}</a>`].filter(Boolean).join(", ")}.<br>` : ""}
      This is an automated message.`,
  };
}

/** A message in the radio's look: logo, a card, one big button, the legal footer. */
function layout(o: { preheader: string; title: string; intro: string; button: { label: string; href: string }; after: string; baseUrl: string }) {
  const legal = footer(o.baseUrl);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px">
      <tr><td align="center" style="padding-bottom:20px">
        <a href="${esc(o.baseUrl)}" style="text-decoration:none;color:#18181b">
          <img src="cid:${LOGO_CID}" width="48" height="48" alt="" style="display:block;border:0;border-radius:12px;margin:0 auto 8px">
          <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em">The Last Radio</span>
        </a>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:14px;padding:32px 28px;border:1px solid #e4e4e7">
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700">${esc(o.title)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46">${o.intro}</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 24px">
          <tr><td align="center" bgcolor="${BRAND}" style="border-radius:10px">
            <a href="${esc(o.button.href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(o.button.label)}</a>
          </td></tr>
        </table>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#71717a">${o.after}</p>
      </td></tr>
      <tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:#8a8a8f;text-align:center">${legal.html}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  return { html, legalText: legal.text };
}

/** "Confirm your email": the link that proves the address is theirs. */
export function confirmationEmail(o: { name: string; email: string; link: string; baseUrl: string }): Email {
  const subject = "Confirm your email for The Last Radio";
  const { html, legalText } = layout({
    baseUrl: o.baseUrl,
    preheader: "One click to confirm your address and join the private stations your email domain opens.",
    title: `Hi ${o.name}, confirm your email`,
    intro: `Confirm that <strong>${esc(o.email)}</strong> is yours to join the private stations your email domain opens.`,
    button: { label: "Confirm my email", href: o.link },
    after: `The button works once, for 24 hours. If it doesn't open, paste this link into your browser:<br>
      <a href="${esc(o.link)}" style="color:#71717a;word-break:break-all">${esc(o.link)}</a>`,
  });
  const text = [
    `Hi ${o.name},`,
    "",
    `Confirm that ${o.email} is yours to join the private stations your email domain opens:`,
    "",
    o.link,
    "",
    "The link works once, for 24 hours.",
    "",
    "-- ",
    "The Last Radio",
    legalText,
    "",
  ].join("\n");
  return {
    subject,
    text,
    html,
    attachments: [{ filename: "the-last-radio.png", content: EMAIL_LOGO_PNG, cid: LOGO_CID, contentType: "image/png" }],
  };
}
