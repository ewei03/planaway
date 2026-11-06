import { createHash } from "node:crypto";
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
import * as confirmCode from "@/app/api/verify-email/confirm/route";
import { getDb, schema as s } from "@/lib/db";
import { contactMessage, renderHtml, renderText, verifyEmailMessage } from "@/lib/email";
import { appUrl } from "@/lib/site";
import { findUserByEmail, getProfile, isEmailVerified, MAX_CODE_ATTEMPTS, verifyCredentials, verifyEmailCode, type UserRef } from "@/lib/store";

function signIn(user: UserRef | null) {
  authMock.mockResolvedValue(user ? { user: { id: user.id, name: user.name } } : null);
}
const req = (method: string, path: string, json?: unknown) =>
  new Request(`http://localhost${path}`, json === undefined ? { method } : { method, body: JSON.stringify(json), headers: { "content-type": "application/json" } });

/** The emails sent so far, oldest first. */
const sent = () => sendMock.mock.calls.map(([email]) => email as Email);
/** The code in the last email to `to`. */
const lastCode = (to: string) => sent().filter((e) => e.to === to).at(-1)!.code!;
/** A code that isn't `code`. */
const otherThan = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
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
  const send = (email: string, ip = "203.0.113.20") =>
    resend.POST(new Request("http://localhost/api/verify-email", { method: "POST", body: JSON.stringify({ email }), headers: { "x-forwarded-for": ip } }));
  const confirm = (email: string, code: string) => confirmCode.POST(req("POST", "/api/verify-email/confirm", { email, code }));

  it("emails a 6-digit code at sign-up, and the account can't plan until it's entered", async () => {
    const user = await registerUser();
    const [email] = sent();
    expect(email).toMatchObject({ to: user.email, subject: "Confirm your email address for PlanAway" });
    expect(email.code).toMatch(/^\d{6}$/);
    expect(email.action).toBeUndefined();
    expect(await isEmailVerified(user.id)).toBe(false);

    signIn(user);
    const refused = await trips.POST();
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatch(/Confirm your email address to plan trips/);

    const res = await confirm(user.email.toUpperCase(), lastCode(user.email));
    expect(await res.json()).toEqual({ verified: true });
    expect(await isEmailVerified(user.id)).toBe(true);
    expect((await trips.POST()).status).toBe(201);
    // Entered again (a double click): still fine.
    expect((await confirm(user.email, lastCode(user.email))).status).toBe(200);
  });

  it("refuses a wrong code, and stops taking guesses after a few", async () => {
    const user = await registerUser();
    const code = lastCode(user.email);
    const wrong = await confirm(user.email, otherThan(code));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toMatch(/isn't right/);
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) await confirm(user.email, otherThan(code));
    const late = await confirm(user.email, code);
    expect((await late.json()).error).toMatch(/expired/);
    expect(await isEmailVerified(user.id)).toBe(false);
    // A new code starts over.
    await send(user.email);
    expect((await confirm(user.email, lastCode(user.email))).status).toBe(200);
  });

  it("counts guesses sent at once", async () => {
    const user = await registerUser();
    const code = lastCode(user.email);
    await Promise.all(Array.from({ length: MAX_CODE_ATTEMPTS + 3 }, () => verifyEmailCode(user.email, otherThan(code))));
    expect(await verifyEmailCode(user.email, code)).toBe("expired");
  });

  it("checks the code's shape, and ignores spaces in it", async () => {
    const user = await registerUser();
    const res = await confirm(user.email, "12ab");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Enter the 6-digit code from the email.");
    const code = lastCode(user.email);
    expect((await confirm(user.email, ` ${code.slice(0, 3)} ${code.slice(3)} `)).status).toBe(200);
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

  it("sends a new code on request, signed out, which replaces the old one, a few times at most", async () => {
    const user = await registerUser();
    const first = lastCode(user.email);
    signIn(null);
    expect(await (await send(user.email)).json()).toEqual({ sent: true });
    if (lastCode(user.email) !== first) expect(await verifyEmailCode(user.email, first)).toBe("wrong");
    await send(user.email);
    await send(user.email);
    const limited = await send(user.email);
    expect(limited.status).toBe(429);
    expect(sent()).toHaveLength(4);
    expect(await verifyEmailCode(user.email, lastCode(user.email))).toBe("verified");
  });

  it("answers the same for addresses without an unconfirmed account, and sends nothing", async () => {
    const confirmed = await makeUser("Confirmed");
    expect(await (await send("nobody-here@example.com")).json()).toEqual({ sent: true });
    expect(await (await send(confirmed.email)).json()).toEqual({ sent: true });
    expect(sent()).toHaveLength(0);
    expect((await (await confirm("nobody-here@example.com", "123456")).json()).error).toMatch(/isn't right/);
  });

  it("still creates the account when the email can't be sent", async () => {
    sendMock.mockRejectedValue(new Error("SMTP down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await registerUser();
    expect(user.id).toBeTruthy();
  });

  it("doesn't need APP_URL, since there's no link", async () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const user = await registerUser();
    expect(lastCode(user.email)).toMatch(/^\d{6}$/);
  });

  it("rejects expired codes", async () => {
    const user = await registerUser();
    const db = await getDb();
    await db.update(s.emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.emailTokens.userId, user.id));
    expect(await verifyEmailCode(user.email, lastCode(user.email))).toBe("expired");
  });

  it("stores only a salted hash of each code", async () => {
    const user = await registerUser();
    const db = await getDb();
    const rows = await db.select().from(s.emailTokens).where(eq(s.emailTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(lastCode(user.email));
    expect(rows[0].tokenHash).not.toBe(createHash("sha256").update(lastCode(user.email)).digest("hex"));
  });
});

describe("changing the email address", () => {
  it("asks to confirm the new address, tells the old one, and old codes stop working", async () => {
    const user = await registerUser();
    const oldCode = lastCode(user.email);
    signIn(user);
    const res = await settings.PATCH(req("PATCH", "/api/settings", { email: "Robin.New@Example.com", password: user.password }));
    expect(await res.json()).toMatchObject({ email: "robin.new@example.com", emailVerified: false });
    const [confirmEmail, notice] = [sent().find((e) => e.to === "robin.new@example.com")!, sent().find((e) => e.to === user.email && !e.code)!];
    expect(confirmEmail.subject).toBe("Confirm your email address for PlanAway");
    expect(notice.subject).toBe("Your PlanAway email address was changed");
    expect(notice.lines.join(" ")).toContain("robin.new@example.com");
    // The account's address is the new one now; the old address has no account.
    expect(await verifyEmailCode(user.email, oldCode)).toBe("wrong");
    const newCode = lastCode("robin.new@example.com");
    if (newCode !== oldCode) expect(await verifyEmailCode("robin.new@example.com", oldCode)).toBe("wrong");
    expect(await verifyEmailCode("robin.new@example.com", newCode)).toBe("verified");
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
  it("says who sent it, and gives the code in both the text and HTML versions", () => {
    vi.stubEnv("OPERATOR_NAME", "Jordan Lee");
    vi.stubEnv("CONTACT_EMAIL", "help@planaway.test");
    const email = verifyEmailMessage("a@example.com", "Robin", "042917");
    expect(renderText(email)).toContain("\n\n042917\n\n");
    expect(renderText(email)).toContain("PlanAway is operated by Jordan Lee. Questions? Write to help@planaway.test.");
    expect(renderHtml(email)).toContain(">042917</p>");
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
