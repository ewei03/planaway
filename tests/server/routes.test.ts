import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, TurnResult } from "@/lib/agent";
import type { UserRef } from "@/lib/store";
import { sampleItinerary } from "../fixtures";
import { makeTrip, makeUser, releaseAllTurns, setTrip, shareTrip } from "./helpers";

// Route handlers are called directly. Auth.js is replaced by a session for
// whichever user `signIn` last chose; the agent's model calls are scripted.
const { authMock, runTurnMock } = vi.hoisted(() => ({ authMock: vi.fn(), runTurnMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent")>()),
  runTurn: runTurnMock,
}));

import * as register from "@/app/api/register/route";
import * as invite from "@/app/api/invites/[token]/route";
import * as trips from "@/app/api/trips/route";
import * as trip from "@/app/api/trips/[id]/route";
import * as tripInvites from "@/app/api/trips/[id]/invites/route";
import * as tripInvite from "@/app/api/trips/[id]/invites/[token]/route";
import * as tripMember from "@/app/api/trips/[id]/members/[userId]/route";
import * as sharing from "@/app/api/trips/[id]/sharing/route";
import * as comments from "@/app/api/trips/[id]/comments/route";
import * as comment from "@/app/api/trips/[id]/comments/[commentId]/route";
import * as exportRoute from "@/app/api/trips/[id]/export/route";
import * as messages from "@/app/api/trips/[id]/messages/route";
import * as revision from "@/app/api/trips/[id]/revision/route";
import * as versions from "@/app/api/trips/[id]/versions/route";
import * as settings from "@/app/api/settings/route";
import * as password from "@/app/api/settings/password/route";
import * as preferences from "@/app/api/settings/preferences/route";
import * as avatarUpload from "@/app/api/settings/avatar/route";
import * as avatars from "@/app/api/avatars/[id]/route";

function signIn(user: UserRef | null) {
  authMock.mockResolvedValue(user ? { user: { id: user.id, name: user.name } } : null);
}

const url = (path: string) => `http://localhost${path}`;
const req = (method: string, path: string, json?: unknown) =>
  new Request(url(path), json === undefined ? { method } : { method, body: JSON.stringify(json), headers: { "content-type": "application/json" } });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

let owner: UserRef, viewer: UserRef, outsider: UserRef;

beforeAll(async () => {
  [owner, viewer, outsider] = await Promise.all([makeUser("Owner"), makeUser("Viewer"), makeUser("Outsider")]);
});

/** A trip owned by `owner` and shared with `viewer` as a viewer. */
async function ownersTrip(itinerary: Parameters<typeof makeTrip>[1] = null) {
  const id = await makeTrip(owner.id, itinerary);
  await shareTrip(owner, id, viewer, "viewer");
  return id;
}

afterEach(releaseAllTurns);

beforeEach(() => {
  signIn(owner);
  runTurnMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("authentication", () => {
  it.each([
    ["GET /api/trips", () => trips.GET()],
    ["POST /api/trips", () => trips.POST()],
    ["GET /api/trips/:id", () => trip.GET(req("GET", "/api/trips/x"), params({ id: "x" }))],
    ["POST /api/trips/:id/messages", () => messages.POST(req("POST", "/x", { text: "hi" }), params({ id: "x" }))],
  ])("%s returns 401 when signed out", async (_name, call) => {
    signIn(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Please sign in." });
  });
});

describe("settings API", () => {
  it("validates profile changes", async () => {
    const patch = (b: unknown) => settings.PATCH(req("PATCH", "/api/settings", b));
    expect((await patch({ name: "  " })).status).toBe(400);
    expect((await patch({ email: "nope" })).status).toBe(400);
    expect(await (await patch({ email: "new@example.com" })).json()).toEqual({ error: "Enter your current password to change your email." });
    expect((await patch({ email: "new@example.com", password: "wrong one" })).status).toBe(403);
  });

  it("deletes the account only with its password", async () => {
    const u = await makeUser("Goner");
    signIn(u);
    expect((await settings.DELETE(req("DELETE", "/api/settings", {}))).status).toBe(400);
    expect((await settings.DELETE(req("DELETE", "/api/settings", { password: "wrong one" }))).status).toBe(403);
    expect((await settings.DELETE(req("DELETE", "/api/settings", { password: u.password }))).status).toBe(204);
    expect((await settings.GET()).status).toBe(404);
  });

  it("changes the password", async () => {
    const u = await makeUser("PasswordChanger");
    signIn(u);
    const put = (b: unknown) => password.PUT(req("PUT", "/api/settings/password", b));
    expect((await put({ current: "nope", next: "a new password" })).status).toBe(403);
    const weak = await put({ current: u.password, next: "short" });
    expect(weak.status).toBe(400);
    expect(await weak.json()).toEqual({ error: "Password must be at least 8 characters." });
    expect((await put({ current: u.password, next: "a new password" })).status).toBe(204);
  });

  it("updates the date of birth, refusing one under 13", async () => {
    const u = await makeUser("DOB");
    signIn(u);
    const patch = (b: unknown) => settings.PATCH(req("PATCH", "/api/settings", b));
    expect(await (await patch({ birthDate: "1985-07-01" })).json()).toMatchObject({ birthDate: "1985-07-01" });
    const young = await patch({ birthDate: `${new Date().getFullYear() - 5}-01-01` });
    expect(young.status).toBe(400);
  });

  it("renames and returns the fresh profile", async () => {
    const u = await makeUser("Renamer");
    signIn(u);
    const res = await settings.PATCH(req("PATCH", "/api/settings", { name: "Renamed" }));
    expect(await res.json()).toMatchObject({ id: u.id, name: "Renamed", email: u.email });
  });

  it("saves valid preferences and rejects invalid ones", async () => {
    // Its own user: saved defaults would show up in other tests' first messages.
    signIn(await makeUser("Prefs"));
    const good = {
      theme: "light",
      activityColors: { rest: "#00aa00" },
      defaults: { currency: "GBP", origin: "Manchester", travelMode: "drive", travelers: 4, pace: "relaxed", language: "fr" },
    };
    const res = await preferences.PUT(req("PUT", "/", good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(good);
    expect((await preferences.PUT(req("PUT", "/", { ...good, theme: "neon" }))).status).toBe(400);
    expect((await preferences.PUT(req("PUT", "/", { theme: "dark" }))).status).toBe(400);
  });

  it("uploads, serves, and removes a profile photo", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    expect((await avatarUpload.PUT(req("PUT", "/", { dataUrl: "data:text/plain;base64,aGk=" }))).status).toBe(400);
    const { avatarUrl } = await (await avatarUpload.PUT(req("PUT", "/", { dataUrl: png }))).json();
    expect(avatarUrl).toContain(`/api/avatars/${owner.id}`);

    const photo = await avatars.GET(req("GET", avatarUrl), params({ id: owner.id }));
    expect(photo.headers.get("content-type")).toBe("image/png");
    expect(photo.headers.get("cache-control")).toContain("immutable");
    signIn(null);
    expect((await avatars.GET(req("GET", avatarUrl), params({ id: owner.id }))).status).toBe(401);
    signIn(owner);
    expect((await avatarUpload.DELETE()).status).toBe(204);
    expect((await avatars.GET(req("GET", avatarUrl), params({ id: owner.id }))).status).toBe(404);
  });
});

describe("POST /api/register", () => {
  const post = (b: unknown) => register.POST(req("POST", "/api/register", b));

  const ok = { name: "A", email: "a@b.co", password: "12345678", birthDate: "1990-04-12" };
  const yearsAgo = (n: number, days = 0) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - n);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  it.each([
    [{ ...ok, name: undefined }, "Name is required."],
    [{ ...ok, email: "not-an-email" }, "Enter a valid email address."],
    [{ ...ok, password: "short" }, "Password must be at least 8 characters."],
    [{ ...ok, password: "é".repeat(40) }, "Password is too long (72 bytes max)."],
    [{ ...ok, password: 12345678 }, "Password must be at least 8 characters."],
    [{ ...ok, birthDate: undefined }, "Enter your date of birth."],
    [{ ...ok, birthDate: "2010-02-30" }, "Enter a valid date of birth."],
    [{ ...ok, birthDate: "12/04/1990" }, "Enter a valid date of birth."],
    [{ ...ok, birthDate: yearsAgo(-1) }, "Your date of birth can't be in the future."],
    [{ ...ok, birthDate: yearsAgo(13, 3) }, "Sorry, you need to be at least 13 to use PlanAway."],
  ])("rejects %j", async (b, error) => {
    const res = await post(b);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("creates an account, then refuses the same email", async () => {
    const b = { name: "New", email: `new-${Date.now()}@example.com`, password: "long enough", birthDate: yearsAgo(13, -1) };
    expect((await post(b)).status).toBe(201);
    const again = await post({ ...b, email: b.email.toUpperCase() });
    expect(again.status).toBe(409);
  });
});

describe("trip sharing API", () => {
  it("validates invite roles and expiry", async () => {
    const id = await ownersTrip();
    const create = (json: unknown) => tripInvites.POST(req("POST", "/", json), params({ id }));
    expect((await create({ role: "owner" })).status).toBe(400);
    expect((await create({ role: "viewer", expiresInDays: 365 })).status).toBe(400);
    expect((await create({ role: "viewer", expiresInDays: null })).status).toBe(201);
    // Expiry defaults to a week.
    const { expiresAt } = await (await create({ role: "viewer" })).json();
    expect((new Date(expiresAt).getTime() - Date.now()) / 86_400_000).toBeCloseTo(7, 1);
    expect((await tripMember.PATCH(req("PATCH", "/", { role: "owner" }), params({ id, userId: viewer.id }))).status).toBe(400);
  });

  it("previews without signing in, and requires signing in to join", async () => {
    const id = await makeTrip(owner.id);
    const { token } = await (await tripInvites.POST(req("POST", "/", { role: "editor" }), params({ id }))).json();

    signIn(null);
    expect(await (await invite.GET(req("GET", "/"), params({ token }))).json()).toMatchObject({ tripId: id, role: "editor", invitedBy: "Owner" });
    expect((await invite.POST(req("POST", "/"), params({ token }))).status).toBe(401);
    expect((await invite.GET(req("GET", "/"), params({ token: "bogus" }))).status).toBe(404);

    const joiner = await makeUser("Joiner");
    signIn(joiner);
    expect(await (await invite.POST(req("POST", "/"), params({ token }))).json()).toEqual({ tripId: id });
    expect((await trip.GET(req("GET", "/"), params({ id }))).status).toBe(200);
    expect(await (await trips.GET()).json()).toMatchObject([{ id, role: "editor", sharedBy: "Owner" }]);

    // Only the sharer sees and manages who has access.
    expect((await sharing.GET(req("GET", "/"), params({ id }))).status).toBe(403);
    signIn(owner);
    expect(await (await sharing.GET(req("GET", "/"), params({ id }))).json()).toMatchObject({ members: [{ id: joiner.id, role: "editor" }] });
    expect((await tripInvite.DELETE(req("DELETE", "/"), params({ id, token }))).status).toBe(204);
    expect((await tripMember.DELETE(req("DELETE", "/"), params({ id, userId: joiner.id }))).status).toBe(204);
    signIn(joiner);
    expect((await trip.GET(req("GET", "/"), params({ id }))).status).toBe(404);
  });
});

describe("trips API", () => {
  it("creates, lists, renames, and deletes trips", async () => {
    const res = await trips.POST();
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await (await trips.GET()).json()).toContainEqual(expect.objectContaining({ id, role: "owner", sharedBy: null }));
    expect((await trip.PATCH(req("PATCH", "/", { title: "" }), params({ id }))).status).toBe(400);
    expect((await trip.PATCH(req("PATCH", "/", { title: "Lisbon" }), params({ id }))).status).toBe(204);
    expect((await (await trip.GET(req("GET", "/"), params({ id }))).json()).title).toBe("Lisbon");
    expect(await (await revision.GET(req("GET", "/"), params({ id }))).json()).toEqual({ revision: expect.any(Number), busy: null, viewers: [] });
    expect((await trip.DELETE(req("DELETE", "/"), params({ id }))).status).toBe(204);
    expect((await trip.GET(req("GET", "/"), params({ id }))).status).toBe(404);
  });

  it("saves versions", async () => {
    const id = await ownersTrip();
    expect((await versions.POST(req("POST", "/", {}), params({ id }))).status).toBe(409);
    await setTrip(id, { itinerary: sampleItinerary() });
    const res = await versions.POST(req("POST", "/", { label: "Draft A" }), params({ id }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ label: "Draft A", itinerary: sampleItinerary() });
  });
});

describe("comments API", () => {
  let tripId: string;
  beforeAll(async () => {
    tripId = await ownersTrip(sampleItinerary());
  });
  const post = (b: unknown) => comments.POST(req("POST", "/", b), params({ id: tripId }));

  it.each([
    [{ body: "  ", targetType: "trip" }, "Comment can't be empty."],
    [{ body: "hi", targetType: "hotel", targetId: "x" }, "Invalid comment target."],
    [{ body: "hi", targetType: "day" }, "targetId is required."],
  ])("rejects %j", async (b, error) => {
    const res = await post(b);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("starts threads, replies, resolves, and deletes", async () => {
    signIn(viewer);
    expect((await post({ body: "Nice", targetType: "trip" })).status).toBe(201);
    const view = await (await trip.GET(req("GET", "/"), params({ id: tripId }))).json();
    const root = view.comments.at(-1);
    expect(root).toMatchObject({ body: "Nice", targetLabel: "Whole trip", targetId: null });

    expect((await post({ body: "Thanks", parentId: root.id })).status).toBe(201);
    const p = params({ id: tripId, commentId: root.id });
    expect((await comment.PATCH(req("PATCH", "/", { resolved: "yes" }), p)).status).toBe(400);
    expect((await comment.PATCH(req("PATCH", "/", { resolved: true }), p)).status).toBe(204);
    expect((await comment.DELETE(req("DELETE", "/"), p)).status).toBe(204);
  });

  it("returns 404 for a reply to a missing thread", async () => {
    expect((await post({ body: "hi", parentId: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
  });
});

describe("GET /api/trips/:id/export", () => {
  let tripId: string;
  beforeAll(async () => {
    tripId = await ownersTrip(sampleItinerary());
  });
  const get = (query: string, id = tripId) => exportRoute.GET(req("GET", `/api/trips/${id}/export${query}`), params({ id }));

  it.each([
    ["csv", "text/csv; charset=utf-8"],
    ["md", "text/markdown; charset=utf-8"],
    ["ics", "text/calendar; charset=utf-8"],
    ["json", "application/json; charset=utf-8"],
  ])("downloads %s", async (format, mime) => {
    const res = await get(`?format=${format}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(mime);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="kyoto-food-weekend.${format}"`);
  });

  it("defaults to CSV", async () => {
    expect((await get("")).headers.get("content-type")).toMatch(/^text\/csv/);
  });

  it.each(["pdf", "toString", "constructor", "__proto__"])("rejects format=%s with 400", async (format) => {
    const res = await get(`?format=${format}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 when there is nothing to export", async () => {
    const empty = await ownersTrip();
    expect((await get("?format=md", empty)).status).toBe(404);
    expect((await get("?format=md&version=00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("returns 422 for a calendar without dates", async () => {
    const it = sampleItinerary();
    it.flights.forEach((f) => (f.date = null));
    it.days.forEach((d) => (d.date = null));
    const undated = await ownersTrip(it);
    const res = await get("?format=ics", undated);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/no dates/);
  });

  it("lets viewers export but not outsiders", async () => {
    signIn(viewer);
    expect((await get("?format=json")).status).toBe(200);
    signIn(outsider);
    expect((await get("?format=json")).status).toBe(404);
  });
});

describe("POST /api/trips/:id/messages", () => {
  const send = (id: string, text: unknown) => messages.POST(req("POST", "/", { text }), params({ id }));

  /** Reads a Server-Sent Events response into its data events. */
  async function events(res: Response): Promise<AgentEvent[]> {
    const raw = await res.text();
    return raw
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)));
  }

  function scriptTurn(result: Partial<TurnResult> | null, emitted: AgentEvent[] = []) {
    runTurnMock.mockImplementation(async (_input, emit: (e: AgentEvent) => void) => {
      emitted.forEach(emit);
      return result && { newMessages: [], reply: "", itinerary: null, commentReplies: [], ...result };
    });
  }

  it("requires text", async () => {
    const id = await ownersTrip();
    expect((await send(id, "   ")).status).toBe(400);
    expect(runTurnMock).not.toHaveBeenCalled();
  });

  it("streams the turn, commits it, and releases the lock", async () => {
    const id = await ownersTrip();
    scriptTurn(
      {
        reply: "Here's Kyoto",
        itinerary: sampleItinerary(),
        newMessages: [
          { role: "user", content: "[Owner] Plan Kyoto" },
          { role: "assistant", content: [{ type: "text", text: "Here's Kyoto" }] },
        ],
      },
      [
        { type: "status", text: "Searching: kyoto" },
        { type: "text", text: "Here's Kyoto" },
      ],
    );
    const res = await send(id, "Plan Kyoto");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await events(res)).toEqual([
      { type: "status", text: "Searching: kyoto" },
      { type: "text", text: "Here's Kyoto" },
      { type: "done", reply: "Here's Kyoto" },
    ]);

    // The agent saw who was speaking, and today's date on the first turn.
    const input = runTurnMock.mock.calls[0][0];
    expect(input.userContent).toMatch(/^\(Today's date is \d{4}-\d{2}-\d{2}\.\)\n\n\[Owner\] Plan Kyoto$/);

    const view = await (await trip.GET(req("GET", "/"), params({ id }))).json();
    expect(view.title).toBe("Kyoto Food Weekend");
    expect(view.chat.map((c: { text: string }) => c.text)).toEqual(["Plan Kyoto", "Here's Kyoto"]);
    expect(view.busy).toBeNull();
  });

  it("commits nothing when the turn fails, and still releases the lock", async () => {
    const id = await ownersTrip();
    scriptTurn(null, [{ type: "error", message: "Rate limited" }]);
    const res = await send(id, "Plan Kyoto");
    expect(await events(res)).toEqual([{ type: "error", message: "Rate limited" }]);
    const view = await (await trip.GET(req("GET", "/"), params({ id }))).json();
    expect(view.chat).toEqual([]);
    expect(view.itinerary).toBeNull();
    expect(view.busy).toBeNull();
  });

  it("releases the lock when the agent throws", async () => {
    const id = await ownersTrip();
    runTurnMock.mockRejectedValue(new Error("boom"));
    expect(await events(await send(id, "hi"))).toEqual([{ type: "error", message: "Failed to save this turn." }]);
    expect((await (await revision.GET(req("GET", "/"), params({ id }))).json()).busy).toBeNull();
  });

  it("returns 409 while someone else's turn is running", async () => {
    const id = await ownersTrip();
    await setTrip(id, { turnStartedAt: new Date(), turnUserId: owner.id });
    const res = await send(id, "hi");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Owner is already asking PlanAway about this trip. Try again when that finishes.");
  });

  it("forbids viewers", async () => {
    const id = await ownersTrip();
    signIn(viewer);
    expect((await send(id, "hi")).status).toBe(403);
  });

  it("caps message length at 8000 characters", async () => {
    const id = await ownersTrip();
    scriptTurn({ reply: "ok" });
    await (await send(id, "x".repeat(10_000))).text();
    expect(runTurnMock.mock.calls[0][0].userContent).toContain(`[Owner] ${"x".repeat(8000)}`);
    expect(runTurnMock.mock.calls[0][0].userContent).not.toContain("x".repeat(8001));
  });
});
