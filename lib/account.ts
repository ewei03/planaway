// Account rules shared by the server and the forms: minimum age and password
// strength. No server-only imports, so the browser can use them too.

/** Youngest age allowed to have an account. */
export const MIN_AGE = 13;

export const UNDER_AGE_MESSAGE = `Sorry, you need to be at least ${MIN_AGE} to use PlanAway.`;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date as YYYY-MM-DD, in local time. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole years from a YYYY-MM-DD birth date to `on` (also YYYY-MM-DD). */
export function ageOn(birthDate: string, on: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/**
 * Why a date of birth can't be used, or null if it can. Comparing against
 * today's date a day ahead of UTC keeps someone whose 13th birthday has started
 * in their own time zone from being turned away.
 */
export function birthDateProblem(value: unknown, now = new Date()): string | null {
  if (typeof value !== "string" || !value) return "Enter your date of birth.";
  const m = ISO_DATE.exec(value);
  const date = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Rejects dates that don't exist, like 2010-02-30.
  if (!m || !date || date.toISOString().slice(0, 10) !== value) return "Enter a valid date of birth.";
  const latest = today(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (value > latest) return "Your date of birth can't be in the future.";
  const age = ageOn(value, latest);
  if (age > 120) return "Enter a valid date of birth.";
  if (age < MIN_AGE) return UNDER_AGE_MESSAGE;
  return null;
}

/** Why a new password can't be used, or null if it can. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  // bcrypt only uses the first 72 bytes.
  if (new TextEncoder().encode(password).length > 72) return "Password is too long (72 bytes max).";
  return null;
}
