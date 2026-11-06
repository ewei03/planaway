import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { contactEmail, operatorName } from "./site";

// Account emails (confirming an address, resetting a password, security
// notices) and contact form messages, sent over SMTP: any provider works
// (Resend, Postmark, Amazon SES, Mailgun, Gmail). Without SMTP_HOST, emails
// are printed to the server log instead, so sign-up works in development;
// EMAIL_OUTBOX_DIR saves them as files for the end-to-end tests.
//
// PlanAway only sends emails someone asked for or needs about their account,
// never marketing, so no unsubscribe link is needed; each one still says who
// sent it and how to reach them.

export interface Email {
  to: string;
  subject: string;
  /** Paragraphs; a link is put on a line of its own. */
  lines: string[];
  /** A button in the HTML version, also given as a plain link. */
  action?: { label: string; url: string };
  /** A one-time code, shown large after the paragraphs. */
  code?: string;
  replyTo?: string;
}

const g = globalThis as typeof globalThis & { __planawayMailer?: Transporter };

function transport(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return (g.__planawayMailer ??= nodemailer.createTransport({
    host,
    port,
    // Port 465 is TLS from the start; 587 upgrades with STARTTLS.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" } : undefined,
  }));
}

const from = () => process.env.EMAIL_FROM?.trim() || "PlanAway <no-reply@localhost>";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Who sent it and how to reach them, at the foot of every email. */
function footer(): string {
  const contact = contactEmail();
  return `PlanAway is operated by ${operatorName()}.${contact ? ` Questions? Write to ${contact}.` : ""}`;
}

export function renderText({ lines, action, code }: Email): string {
  return [...lines, ...(code ? [code] : []), ...(action ? [`${action.label}: ${action.url}`] : []), "", "—", footer()].join("\n\n");
}

export function renderHtml({ subject, lines, action, code }: Email): string {
  const p = (s: string) => `<p style="margin:0 0 16px">${escape(s)}</p>`;
  const button = action
    ? `<p style="margin:24px 0"><a href="${escape(action.url)}" style="background:#0f6e63;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${escape(action.label)}</a></p>` +
      p(`Or paste this link into your browser: ${action.url}`)
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f5f2ec;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d1c1a">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px">
<p style="margin:0 0 20px;font-weight:700;font-size:18px">PlanAway</p>
${lines.map(p).join("\n")}
${code ? `<p style="margin:8px 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace">${escape(code)}</p>` : ""}
${button}
<p style="margin:24px 0 0;color:#6b6860;font-size:13px">${escape(footer())}</p>
</div></body></html>`;
}

/** Sends an email; throws if the provider refuses it. */
export async function sendEmail(email: Email): Promise<void> {
  const message = { from: from(), to: email.to, replyTo: email.replyTo, subject: email.subject, text: renderText(email), html: renderHtml(email) };
  const mailer = transport();
  if (mailer) {
    await mailer.sendMail(message);
    return;
  }
  const outbox = process.env.EMAIL_OUTBOX_DIR;
  if (outbox) {
    await mkdir(outbox, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await writeFile(path.join(outbox, name), JSON.stringify({ ...message, action: email.action ?? null, code: email.code ?? null }, null, 2));
    return;
  }
  if (process.env.NODE_ENV === "production") console.warn(`SMTP_HOST isn't set, so this email to ${email.to} wasn't sent: "${email.subject}".`);
  console.info(`\n--- Email (not sent: SMTP_HOST isn't set) ---\nTo: ${email.to}\nSubject: ${email.subject}\n\n${message.text}\n---\n`);
}

// ---------- The emails ----------

export const verifyEmailMessage = (to: string, name: string, code: string): Email => ({
  to,
  subject: "Confirm your email address for PlanAway",
  lines: [
    `Hi ${name},`,
    "Enter this code in PlanAway to confirm your email address. It works for 30 minutes. If you didn't create a PlanAway account, you can ignore this email.",
  ],
  code,
});

export const resetPasswordMessage = (to: string, name: string, url: string): Email => ({
  to,
  subject: "Reset your PlanAway password",
  lines: [
    `Hi ${name},`,
    "Someone asked to reset the password for your PlanAway account. If it was you, choose a new password with the link below. It works for one hour.",
    "If you didn't ask, you can ignore this email: your password stays the same.",
  ],
  action: { label: "Choose a new password", url },
});

export const emailChangedMessage = (to: string, name: string, newEmail: string): Email => ({
  to,
  subject: "Your PlanAway email address was changed",
  lines: [
    `Hi ${name},`,
    `The email address for your PlanAway account was changed to ${newEmail}. You'll sign in with that address from now on.`,
    contactEmail()
      ? `If you didn't make this change, write to ${contactEmail()} right away so we can secure your account.`
      : "If you didn't make this change, contact us right away so we can secure your account.",
  ],
});

export const contactMessage = (to: string, from: { name: string; email: string }, topic: string, message: string): Email => ({
  to,
  replyTo: from.email,
  subject: `PlanAway: ${topic} from ${from.name}`,
  lines: [`From: ${from.name} <${from.email}>`, `Topic: ${topic}`, ...message.split(/\n{2,}/)],
});
