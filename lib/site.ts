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
