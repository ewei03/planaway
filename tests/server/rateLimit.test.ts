import { afterEach, describe, expect, it, vi } from "vitest";
import { allow, clientIp, limited, record } from "@/lib/rateLimit";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("allow", () => {
  it("lets a few through per window, then refuses until the window moves on", () => {
    vi.useFakeTimers();
    expect([1, 2, 3].map(() => allow("k", 3, 1000))).toEqual([true, true, true]);
    expect(allow("k", 3, 1000)).toBe(false);
    expect(allow("other", 3, 1000)).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(allow("k", 3, 1000)).toBe(true);
  });

  it("can be switched off for the end-to-end tests", () => {
    vi.stubEnv("PLANAWAY_RATE_LIMITS", "off");
    expect([1, 2, 3, 4].every(() => allow("off", 1, 1000))).toBe(true);
  });
});

describe("limited and record", () => {
  it("count only what's recorded, such as wrong passwords", () => {
    for (let i = 0; i < 5; i++) expect(limited("signin:a", 3, 1000)).toBe(false);
    record("signin:a", 1000);
    record("signin:a", 1000);
    expect(limited("signin:a", 3, 1000)).toBe(false);
    record("signin:a", 1000);
    expect(limited("signin:a", 3, 1000)).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first address the proxy reports", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }))).toBe("203.0.113.5");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe("198.51.100.2");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
