// A small in-memory limit on how often something may happen: things that send
// email (sign-up confirmations, password resets, the contact form), and wrong
// passwords at sign-in.
// Per server process, which is enough for one PlanAway server; it resets on
// restart.

const g = globalThis as typeof globalThis & { __planawayRateLimits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__planawayRateLimits ??= new Map());

/**
 * Records a try for `key` and says whether it's allowed: at most `max` in any `windowMs`.
 * PLANAWAY_RATE_LIMITS=off turns limits off, for the end-to-end tests, which sign up many accounts from one address.
 */
export function allow(key: string, max: number, windowMs: number): boolean {
  if (limited(key, max, windowMs)) return false;
  record(key, windowMs);
  return true;
}

/** Whether `key` has had `max` tries in the last `windowMs`, without counting this as one. */
export function limited(key: string, max: number, windowMs: number): boolean {
  if (process.env.PLANAWAY_RATE_LIMITS === "off") return false;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, recent);
  return recent.length >= max;
}

/** Counts a try for `key`, e.g. a wrong password. */
export function record(key: string, windowMs: number): void {
  const now = Date.now();
  hits.set(key, [...(hits.get(key) ?? []), now]);
  // Don't grow without bound: forget keys with nothing recent now and then.
  if (hits.size > 10_000) for (const [k, ts] of hits) if (!ts.some((t) => now - t < windowMs)) hits.delete(k);
}

/** The caller's address, as the proxy in front of PlanAway reports it; "unknown" without one. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** For tests. */
export function resetRateLimits() {
  hits.clear();
}
