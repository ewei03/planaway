import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Email } from "@/lib/email";
import { makeTrip, makeUser, releaseAllTurns, shareTrip } from "./helpers";

// Emails are captured instead of sent; Auth.js is replaced by a session for
// whichever user `signIn` last chose.
const { authMock, sendMock } = vi.hoisted(() => ({ authMock: vi.fn(), sendMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/email")>()), sendEmail: sendMock }));

import * as contact from "@/app/api/contact/route";
import * as resetRequest from "@/app/api/password-reset/route";
import * as resetConfirm from "@/app/api/password-reset/confirm/route";
import * as register from "@/app/api/register/route";
import * as settings from "@/app/api/settings/route";
import * as dataExport from "@/app/api/settings/export/route";
import * as trips from "@/app/api/trips/route";
import * as messages from "@/app/api/trips/[id]/messages/route";
import * as resend from "@/app/api/verify-email/route";
import { getDb, schema as s } from "@/lib/db";
import { contactMessage, renderHtml, renderText, verifyEmailMessage } from "@/lib/email";
import { appUrl } from "@/lib/site";
import { findUserByEmail, getProfile, verifyCredentials, verifyEmail, type UserRef } from "@/lib/store";

function signIn(user: UserRef | null) {
  authMock.mockResolvedValue(user ? { user: { id: user.id, name: user.name } } : null);
}
const req = (method: string, path: string, json?: unknown) =>
  new Request(`http://localhost${path}`, json === undefined ? { method } : { method, body: JSON.stringify(json), headers: { "content-type": "application/json" } });

/** The emails sent so far, oldest first. */
const sent = () => sendMock.mock.calls.map(([email]) => email as Email);
/** The token in the link of the last email to `to`. */
const lastToken = (to: string) => new URL(sent().filter((e) => e.to === to).at(-1)!.action!.url).searchParams.get("token")!;

let n = 0;
const fresh = () => ({ name: "Robin", email: `robin-${++n}-${Date.now()}@example.com`, password: "a good password", birthDate: "1990-04-12" });

/** Registers through the route, as the sign-up form does. */
async function registerUser() {
  const who = fresh();
  expect((await register.POST(req("POST", "/api/register", who))).status).toBe(201);
  const user = (await findUserByEmail(who.email))!;
  return { ...who, ...user };
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
  vi.unstubAllEnvs();
});
afterEach(releaseAllTurns);

describe("confirming an email address", () => {
  it("emails a link at sign-up, and the account can't plan until it's opened", async () => {
    const user = await registerUser();
    const [email] = sent();
    expect(email).toMatchObject({ to: user.email, subject: "Confirm your email address for PlanAway" });
    expect(email.action!.url).toMatch(/^http:\/\/localhost\/verify-email\?token=[\w-]{40,}$/);
    expect((await getProfile(user.id)).emailVerified).toBe(false);

    signIn(user);
    const refused = await trips.POST();
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatch(/Confirm your email address to plan trips/);

    expect(await verifyEmail(lastToken(user.email))).toBe("verified");
    expect((await getProfile(user.id)).emailVerified).toBe(true);
    expect((await trips.POST()).status).toBe(201);
    // Opened again, or by a mail scanner first: still fine.
    expect(await verifyEmail(lastToken(user.email))).toBe("invalid");
  });

  it("says when an address is already confirmed", async () => {
    const user = await registerUser();
    const token = lastToken(user.email);
    const db = await getDb();
    await db.update(s.users).set({ emailVerifiedAt: new Date() }).where(eq(s.users.id, user.id));
    expect(await verifyEmail(token)).toBe("already");
  });

  it("lets an unconfirmed editor see a shared trip, but not plan with it", async () => {
    const owner = await makeUser("Owner");
    const user = await registerUser();
    const tripId = await makeTrip(owner.id);
    await shareTrip(owner, tripId, user, "editor");
    signIn(user);
    const res = await messages.POST(req("POST", `/api/trips/${tripId}/messages`, { text: "Plan it" }), { params: Promise.resolve({ id: tripId }) });
    expect(res.status).toBe(403);
  });

  it("sends a new link on request, which replaces the old one, a few times at most", async () => {
    const user = await registerUser();
    const first = lastToken(user.email);
    signIn(user);
    expect(await (await resend.POST(req("POST", "/api/verify-email"))).json()).toEqual({ sent: true });
    expect(await verifyEmail(first)).toBe("invalid");
    await resend.POST(req("POST", "/api/verify-email"));
    await resend.POST(req("POST", "/api/verify-email"));
    const limited = await resend.POST(req("POST", "/api/verify-email"));
    expect(limited.status).toBe(429);
    expect(sent()).toHaveLength(4);
    expect(await verifyEmail(lastToken(user.email))).toBe("verified");
    expect(await (await resend.POST(req("POST", "/api/verify-email"))).json()).toEqual({ verified: true });
  });

  it("needs a signed-in user to send a new link", async () => {
    signIn(null);
    expect((await resend.POST(req("POST", "/api/verify-email"))).status).toBe(401);
  });

  it("still creates the account when the email can't be sent", async () => {
    sendMock.mockRejectedValue(new Error("SMTP down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await registerUser();
    expect(user.id).toBeTruthy();
  });

  it("rejects expired and made-up links", async () => {
    const user = await registerUser();
    const token = lastToken(user.email);
    const db = await getDb();
    await db.update(s.emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.emailTokens.userId, user.id));
    expect(await verifyEmail(token)).toBe("invalid");
    expect(await verifyEmail("made-up")).toBe("invalid");
    expect(await verifyEmail("")).toBe("invalid");
  });

  it("stores only a hash of each link's token", async () => {
    const user = await registerUser();
    const db = await getDb();
    const rows = await db.select().from(s.emailTokens).where(eq(s.emailTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(lastToken(user.email));
  });
});

describe("changing the email address", () => {
  it("asks to confirm the new address, tells the old one, and old links stop working", async () => {
    const user = await registerUser();
    const oldLink = lastToken(user.email);
    signIn(user);
    const res = await settings.PATCH(req("PATCH", "/api/settings", { email: "Robin.New@Example.com", password: user.password }));
    expect(await res.json()).toMatchObject({ email: "robin.new@example.com", emailVerified: false });
    const [confirm, notice] = [sent().find((e) => e.to === "robin.new@example.com")!, sent().find((e) => e.to === user.email && !e.action)!];
    expect(confirm.subject).toBe("Confirm your email address for PlanAway");
    expect(notice.subject).toBe("Your PlanAway email address was changed");
    expect(notice.lines.join(" ")).toContain("robin.new@example.com");
    expect(await verifyEmail(oldLink)).toBe("invalid");
    expect(await verifyEmail(lastToken("robin.new@example.com"))).toBe("verified");
  });

  it("sends nothing when the address doesn't change", async () => {
    const user = await makeUser("Same");
    signIn(user);
    await settings.PATCH(req("PATCH", "/api/settings", { email: user.email, password: user.password }));
    expect(sent()).toHaveLength(0);
    expect((await getProfile(user.id)).emailVerified).toBe(true);
  });
});

describe("resetting a password", () => {
  const ask = (email: string, ip = "203.0.113.1") =>
    resetRequest.POST(new Request("http://localhost/api/password-reset", { method: "POST", body: JSON.stringify({ email }), headers: { "x-forwarded-for": ip } }));
  const confirm = (token: string, password: string) => resetConfirm.POST(req("POST", "/api/password-reset/confirm", { token, password }));

  it("emails a link that sets a new password once", async () => {
    const user = await makeUser("Forgetful");
    expect(await (await ask(` ${user.email.toUpperCase()} `)).json()).toEqual({ ok: true });
    const [email] = sent();
    expect(email).toMatchObject({ to: user.email, subject: "Reset your PlanAway password" });
    expect(email.action!.url).toMatch(/^http:\/\/localhost\/reset-password\?token=/);

    const token = lastToken(user.email);
    expect((await confirm(token, "a brand new password")).status).toBe(200);
    expect(await verifyCredentials(user.email, "a brand new password")).toMatchObject({ id: user.id });
    expect(await verifyCredentials(user.email, user.password)).toBeNull();
    const again = await confirm(token, "yet another password");
    expect(again.status).toBe(400);
    expect((await again.json()).error).toMatch(/expired or was already used/);
  });

  it("answers the same for addresses without an account, and sends nothing", async () => {
    const res = await ask("nobody-here@example.com");
    expect(await res.json()).toEqual({ ok: true });
    expect(sent()).toHaveLength(0);
  });

  it("confirms the address too: the link proves it's theirs", async () => {
    const user = await registerUser();
    sendMock.mockClear();
    await ask(user.email);
    await confirm(lastToken(user.email), "a brand new password");
    expect((await getProfile(user.id)).emailVerified).toBe(true);
  });

  it("checks the new password, and keeps the link working until it's used", async () => {
    const user = await makeUser("Short");
    await ask(user.email);
    const token = lastToken(user.email);
    const res = await confirm(token, "short");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Password must be at least 8 characters.");
    expect((await confirm(token, "long enough now")).status).toBe(200);
  });

  it("expires links after an hour", async () => {
    const user = await makeUser("Late");
    await ask(user.email);
    const db = await getDb();
    await db.update(s.emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.emailTokens.userId, user.id));
    expect((await confirm(lastToken(user.email), "a brand new password")).status).toBe(400);
  });

  it("limits emails per address quietly, and requests per caller out loud", async () => {
    const user = await makeUser("Spammed");
    for (let i = 0; i < 5; i++) expect((await ask(user.email, `198.51.100.${i}`)).status).toBe(200);
    expect(sent()).toHaveLength(3);
    for (let i = 0; i < 10; i++) await ask("someone@example.com", "192.0.2.9");
    expect((await ask("someone@example.com", "192.0.2.9")).status).toBe(429);
  });

  it("rejects an address that isn't one", async () => {
    expect((await ask("not an email")).status).toBe(400);
  });
});

describe("the contact form", () => {
  const post = (b: Record<string, unknown>, ip = "203.0.113.50") =>
    contact.POST(new Request("http://localhost/api/contact", { method: "POST", body: JSON.stringify(b), headers: { "x-forwarded-for": ip } }));
  const ok = { name: "Sam", email: "sam@example.com", topic: "Ideas and feedback", message: "Could trips have packing lists?" };

  beforeEach(() => vi.stubEnv("CONTACT_EMAIL", "help@planaway.test"));

  it("emails the message to the team, with replies going to the sender", async () => {
    expect(await (await post(ok)).json()).toEqual({ ok: true });
    const [email] = sent();
    expect(email).toMatchObject({ to: "help@planaway.test", replyTo: "sam@example.com", subject: "PlanAway: Ideas and feedback from Sam" });
    expect(email.lines).toContain("Could trips have packing lists?");
  });

  it.each([
    [{ ...ok, name: "" }, "Enter your name."],
    [{ ...ok, email: "nope" }, "Enter a valid email address, so we can reply."],
    [{ ...ok, message: "Hi" }, "Tell us a little more in your message."],
  ])("checks %j", async (b, error) => {
    const res = await post(b);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("keeps names and addresses to one line, and unknown topics to the catch-all", async () => {
    await post({ ...ok, name: "Sam\r\nBcc: victim@example.com", topic: "Free money" });
    expect(sent()[0].subject).toBe("PlanAway: Something else from Sam Bcc: victim@example.com");
  });

  it("quietly drops what bots send", async () => {
    expect((await post({ ...ok, website: "http://spam.example" })).status).toBe(200);
    expect(sent()).toHaveLength(0);
  });

  it("limits how often one caller can send", async () => {
    for (let i = 0; i < 5; i++) expect((await post(ok, "198.51.100.77")).status).toBe(200);
    expect((await post(ok, "198.51.100.77")).status).toBe(429);
  });

  it("says when it isn't set up, or the email can't be sent", async () => {
    vi.stubEnv("CONTACT_EMAIL", "");
    expect((await post(ok)).status).toBe(503);
    vi.stubEnv("CONTACT_EMAIL", "help@planaway.test");
    sendMock.mockRejectedValue(new Error("SMTP down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(ok);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("help@planaway.test");
  });
});

describe("downloading your data", () => {
  it("gives everything about the account and its trips, but never the password hash", async () => {
    const user = await makeUser("Exporter");
    const tripId = await makeTrip(user.id);
    signIn(user);
    const res = await dataExport.GET();
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="planaway-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.account).toMatchObject({ name: "Exporter", email: user.email });
    expect(data.trips.map((t: { id: string }) => t.id)).toEqual([tripId]);
    expect(text).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("needs a signed-in user", async () => {
    signIn(null);
    expect((await dataExport.GET()).status).toBe(401);
  });
});

describe("email content", () => {
  it("says who sent it, and links in both the text and HTML versions", () => {
    vi.stubEnv("OPERATOR_NAME", "Jordan Lee");
    vi.stubEnv("CONTACT_EMAIL", "help@planaway.test");
    const email = verifyEmailMessage("a@example.com", "Robin", "https://planaway.example/verify-email?token=abc");
    expect(renderText(email)).toContain("Confirm email address: https://planaway.example/verify-email?token=abc");
    expect(renderText(email)).toContain("PlanAway is operated by Jordan Lee. Questions? Write to help@planaway.test.");
    expect(renderHtml(email)).toContain('href="https://planaway.example/verify-email?token=abc"');
  });

  it("never lets what people write become HTML", () => {
    const html = renderHtml(contactMessage("help@x.test", { name: "<b>Sam</b>", email: "s@x.test" }, "Something else", "<script>alert(1)</script>"));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>Sam</b>");
  });
});

describe("appUrl", () => {
  const r = new Request("http://evil.example/api/password-reset");

  it("uses APP_URL, so a forged Host can't redirect reset links", () => {
    vi.stubEnv("APP_URL", "https://planaway.example/");
    expect(appUrl(r)).toBe("https://planaway.example");
  });

  it("falls back to the request in development, and refuses to guess in production", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(appUrl(r)).toBe("http://evil.example");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => appUrl(r)).toThrow(/Set APP_URL/);
  });
});
