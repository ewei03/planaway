// Who runs this PlanAway, how to reach them, and where it lives: read from the
// environment when a page or email is made, so one build can serve any site.

/** The contact address, from CONTACT_EMAIL; null until it's set. */
export function contactEmail(): string | null {
  return process.env.CONTACT_EMAIL?.trim() || null;
}

/** What the contact form asks about; the last is the catch-all. */
export const CONTACT_TOPICS = ["Something isn't working", "Account help", "Ideas and feedback", "Privacy questions", "Something else"];

/** The person or business that runs PlanAway, named on the legal pages and in emails (OPERATOR_NAME). */
export function operatorName(): string {
  return process.env.OPERATOR_NAME?.trim() || "the PlanAway team";
}

/**
 * The site's public address, for links in emails. Set APP_URL in production:
 * the Host header of a request can be forged, and a forged one would send
 * password reset links to someone else's site. In development the request's
 * own address is fine.
 */
export function appUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("Set APP_URL to the site's public address, e.g. https://planaway.example.com.");
  return new URL(req.url).origin;
}

/**
 * Whether new accounts confirm their email address with a code before they
 * can sign in and plan. Off unless EMAIL_VERIFICATION=on, since it needs a
 * working email provider (SMTP_HOST). While it's off, every account counts
 * as confirmed; the daily limit on agent turns (dailyTurnLimit) still holds.
 */
export function emailVerificationOn(): boolean {
  return process.env.EMAIL_VERIFICATION?.trim().toLowerCase() === "on";
}

/**
 * Agent turns each account can start in 24 hours, so no one account can run
 * up the AI bill: PLANAWAY_DAILY_TURNS, 20 by default, 0 for no limit.
 */
export function dailyTurnLimit(): number {
  const raw = process.env.PLANAWAY_DAILY_TURNS?.trim();
  if (!raw) return 20;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
}

/**
 * Whether emails actually reach people: SMTP_HOST is set (or, in the
 * end-to-end tests, EMAIL_OUTBOX_DIR). Without it they're only printed to the
 * server log, so pages that rely on an email, like "Forgot password?", say to
 * get in touch instead.
 */
export function emailSendingOn(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() || process.env.EMAIL_OUTBOX_DIR?.trim());
}
