import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema as s } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  acceptTripInvite,
  addComment,
  claimTurn,
  commitTurn,
  createTrip,
  createTripInvite,
  createUser,
  deleteComment,
  deleteTrip,
  getInvitePreview,
  getItineraryForExport,
  getTripRevision,
  getTripSharing,
  getTripView,
  listTrips,
  loadTurnContext,
  releaseTurn,
  removeTripMember,
  renameTrip,
  requireRole,
  revokeTripInvite,
  saveVersion,
  setTripMemberRole,
  setThreadResolved,
  tripAccess,
  verifyCredentials,
  type TurnCommit,
  type UserRef,
} from "@/lib/store";
import { sampleItinerary } from "../fixtures";
import { makeTrip, makeUser, releaseAllTurns, setTrip, shareTrip } from "./helpers";

// One cast of characters for the whole file; each test makes its own trips
// so tests don't depend on each other.
let owner: UserRef, editor: UserRef, viewer: UserRef, outsider: UserRef;

afterEach(releaseAllTurns);

beforeAll(async () => {
  [owner, editor, viewer, outsider] = await Promise.all([makeUser("Owner"), makeUser("Editor"), makeUser("Viewer"), makeUser("Outsider")]);
});

/** A trip owned by `owner` and shared with `editor` and `viewer` at those roles. */
async function crewTrip(itinerary: Parameters<typeof makeTrip>[1] = null) {
  const tripId = await makeTrip(owner.id, itinerary);
  await shareTrip(owner, tripId, editor, "editor");
  await shareTrip(owner, tripId, viewer, "viewer");
  return tripId;
}

describe("requireRole", () => {
  it("allows equal or higher roles", () => {
    expect(() => requireRole("owner", "editor", "x")).not.toThrow();
    expect(() => requireRole("editor", "editor", "x")).not.toThrow();
  });

  it("rejects lower roles with a readable message", () => {
    expect(() => requireRole("viewer", "editor", "plan trips")).toThrow(new ForbiddenError("You need editor access to plan trips."));
  });
});

describe("users", () => {
  it("starts new users with no trips", async () => {
    const u = await makeUser("Solo");
    expect(await listTrips(u.id)).toEqual([]);
  });

  it("normalizes email and rejects duplicates case-insensitively", async () => {
    const u = await makeUser("Dup");
    await expect(createUser("Again", `  ${u.email.toUpperCase()} `, "password123")).rejects.toBeInstanceOf(ConflictError);
  });

  it("verifies credentials", async () => {
    const u = await makeUser("Login");
    expect(await verifyCredentials(u.email, u.password)).toEqual({ id: u.id, name: "Login", email: u.email });
    expect(await verifyCredentials(` ${u.email.toUpperCase()}`, u.password)).toMatchObject({ id: u.id });
    expect(await verifyCredentials(u.email, "wrong password")).toBeNull();
    expect(await verifyCredentials("nobody@example.com", u.password)).toBeNull();
  });

  it("never stores the plain password", async () => {
    const u = await makeUser("Hash");
    const db = await getDb();
    const [row] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    expect(row.passwordHash).not.toContain(u.password);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });
});

describe("listing trips", () => {
  it("lists the user's own trips and trips shared with them, most recently updated first", async () => {
    const u = await makeUser("Lister");
    const mine = await makeTrip(u.id, sampleItinerary());
    const theirs = await makeTrip(owner.id);
    await shareTrip(owner, theirs, u, "editor");
    await makeTrip(owner.id); // not shared
    expect(await listTrips(u.id)).toMatchObject([
      { id: theirs, title: "New trip", role: "editor", sharedBy: "Owner", hasItinerary: false },
      { id: mine, role: "owner", sharedBy: null, hasItinerary: true },
    ]);
    await renameTrip(u.id, mine, "Bumped");
    expect((await listTrips(u.id)).map((t) => t.id)).toEqual([mine, theirs]);
    expect((await listTrips(u.id))[0]).not.toHaveProperty("createdBy");
  });
});

describe("sharing one trip", () => {
  it("creates unguessable links with a chosen expiry, or none", async () => {
    const tripId = await makeTrip(owner.id, sampleItinerary());
    const a = await createTripInvite(owner.id, tripId, "editor", 7);
    const b = await createTripInvite(owner.id, tripId, "viewer", null);
    expect(a.token).not.toBe(b.token);
    // 24 random bytes, base64url.
    expect(a.token).toMatch(/^[\w-]{32}$/);
    expect((new Date(a.expiresAt!).getTime() - Date.now()) / 86_400_000).toBeCloseTo(7, 1);
    expect(b.expiresAt).toBeNull();
    expect((await getTripSharing(owner.id, tripId)).invites.map((i) => i.token).sort()).toEqual([a.token, b.token].sort());
  });

  it("shows the trip's details before joining, without needing an account", async () => {
    const tripId = await crewTrip(sampleItinerary());
    const { token } = await createTripInvite(owner.id, tripId, "viewer", 7);
    expect(await getInvitePreview(token)).toMatchObject({
      tripId,
      title: "New trip",
      summary: sampleItinerary().summary,
      destinations: sampleItinerary().destinations,
      days: sampleItinerary().days.length,
      role: "viewer",
      invitedBy: "Owner",
    });
  });

  it("gives access to that one trip only, not the owner's other trips", async () => {
    const sharedTrip = await makeTrip(owner.id, sampleItinerary());
    const otherTrip = await makeTrip(owner.id);
    const guest = await makeUser("Guest");
    await expect(getTripView(guest.id, sharedTrip)).rejects.toBeInstanceOf(NotFoundError);

    const { token } = await createTripInvite(owner.id, sharedTrip, "viewer", 7);
    expect(await acceptTripInvite(guest.id, token)).toEqual({ tripId: sharedTrip });

    expect(await getTripView(guest.id, sharedTrip)).toMatchObject({
      role: "viewer",
      sharedBy: { id: owner.id, name: "Owner" },
    });
    await expect(getTripView(guest.id, otherTrip)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listTrips(guest.id)).toMatchObject([{ id: sharedTrip, role: "viewer", sharedBy: "Owner", hasItinerary: true }]);
  });

  it("lets editors change the plan and viewers only view and comment", async () => {
    const tripId = await makeTrip(owner.id, sampleItinerary());
    const [ed, vw] = await Promise.all([makeUser("SharedEditor"), makeUser("SharedViewer")]);
    await shareTrip(owner, tripId, ed, "editor");
    await shareTrip(owner, tripId, vw, "viewer");

    await renameTrip(ed.id, tripId, "Edited");
    expect(await claimTurn(ed.id, tripId)).toBe(true);
    await releaseTurn(tripId);

    await expect(renameTrip(vw.id, tripId, "Nope")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveVersion(vw.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(claimTurn(vw.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
    await addComment(vw.id, tripId, { targetType: "trip", targetId: null, targetLabel: "Trip", body: "Looks great" });

    // Neither can delete or re-share someone else's trip.
    for (const u of [ed, vw]) {
      await expect(deleteTrip(u.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createTripInvite(u.id, tripId, "viewer", 7)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("lets only the trip's owner share it", async () => {
    const tripId = await crewTrip();
    await expect(createTripInvite(editor.id, tripId, "viewer", 7)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTripInvite(viewer.id, tripId, "viewer", 7)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTripSharing(editor.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
    await createTripInvite(owner.id, tripId, "viewer", 7);
  });

  it("rejects revoked and expired links", async () => {
    const tripId = await makeTrip(owner.id);
    const revoked = await createTripInvite(owner.id, tripId, "editor", 7);
    await revokeTripInvite(owner.id, tripId, revoked.token);
    await expect(getInvitePreview(revoked.token)).rejects.toBeInstanceOf(NotFoundError);
    await expect(acceptTripInvite(outsider.id, revoked.token)).rejects.toBeInstanceOf(NotFoundError);

    const expired = await createTripInvite(owner.id, tripId, "editor", 1);
    const db = await getDb();
    await db.update(s.tripInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.tripInvites.token, expired.token));
    await expect(getInvitePreview(expired.token)).rejects.toBeInstanceOf(NotFoundError);
    await expect(acceptTripInvite(outsider.id, expired.token)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getTripSharing(owner.id, tripId)).invites).toEqual([]);
  });

  it("can't revoke another trip's link through your own trip", async () => {
    const mine = await makeTrip(owner.id);
    const theirs = await makeTrip(editor.id);
    const { token } = await createTripInvite(editor.id, theirs, "viewer", 7);
    await revokeTripInvite(owner.id, mine, token);
    expect(await getInvitePreview(token)).toMatchObject({ tripId: theirs });
  });

  it("upgrades a viewer who opens an editor link, and never downgrades", async () => {
    const tripId = await makeTrip(owner.id);
    const u = await makeUser("Upgrade");
    await shareTrip(owner, tripId, u, "viewer");
    await shareTrip(owner, tripId, u, "editor");
    expect((await getTripView(u.id, tripId)).role).toBe("editor");
    await shareTrip(owner, tripId, u, "viewer");
    expect((await getTripView(u.id, tripId)).role).toBe("editor");
  });

  it("leaves the owner's access alone when they open their own link", async () => {
    const tripId = await makeTrip(owner.id);
    const { token } = await createTripInvite(owner.id, tripId, "viewer", 7);
    await acceptTripInvite(owner.id, token);
    expect((await getTripView(owner.id, tripId)).role).toBe("owner");
    expect((await getTripSharing(owner.id, tripId)).members).toEqual([]);
  });

  it("lets the sharer change roles and remove people, and people leave", async () => {
    const tripId = await makeTrip(owner.id);
    const a = await makeUser("A");
    const b = await makeUser("B");
    await shareTrip(owner, tripId, a);
    await shareTrip(owner, tripId, b);
    expect((await getTripSharing(owner.id, tripId)).members.map((m) => m.name)).toEqual(["A", "B"]);

    await setTripMemberRole(owner.id, tripId, a.id, "editor");
    expect((await getTripView(a.id, tripId)).role).toBe("editor");
    await expect(setTripMemberRole(owner.id, tripId, outsider.id, "editor")).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeTripMember(a.id, tripId, b.id)).rejects.toBeInstanceOf(ForbiddenError);

    await removeTripMember(owner.id, tripId, a.id);
    await expect(getTripView(a.id, tripId)).rejects.toBeInstanceOf(NotFoundError);
    await removeTripMember(b.id, tripId, b.id);
    expect(await listTrips(b.id)).toEqual([]);
  });

  it("deleting the trip removes its links and shared access", async () => {
    const tripId = await makeTrip(owner.id);
    const u = await makeUser("Gone");
    const { token } = await createTripInvite(owner.id, tripId, "viewer", null);
    await acceptTripInvite(u.id, token);
    await deleteTrip(owner.id, tripId);
    expect(await listTrips(u.id)).toEqual([]);
    await expect(getInvitePreview(token)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("trips", () => {
  it("makes whoever creates a trip its owner", async () => {
    const { id } = await createTrip(outsider.id);
    expect(await getTripView(outsider.id, id)).toMatchObject({ role: "owner", sharedBy: null });
  });

  it("returns a full view to people it's shared with and not found to everyone else", async () => {
    const tripId = await crewTrip(sampleItinerary());
    const view = await getTripView(viewer.id, tripId);
    expect(view).toMatchObject({ id: tripId, role: "viewer", sharedBy: { id: owner.id, name: "Owner" }, busy: null });
    expect(view.itinerary).toEqual(sampleItinerary());
    await expect(getTripView(outsider.id, tripId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects malformed trip ids before querying", async () => {
    await expect(tripAccess(owner.id, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(tripAccess(owner.id, "'; drop table trips; --")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("renaming requires editor and bumps the revision", async () => {
    const tripId = await crewTrip();
    await expect(renameTrip(viewer.id, tripId, "Mine")).rejects.toBeInstanceOf(ForbiddenError);
    const before = (await getTripRevision(owner.id, tripId)).revision;
    await renameTrip(editor.id, tripId, "Spring break");
    expect((await getTripRevision(owner.id, tripId)).revision).toBeGreaterThan(before);
    expect((await getTripView(owner.id, tripId)).title).toBe("Spring break");
  });

  it("reports who else has a trip open, from recent polls", async () => {
    const tripId = await crewTrip();
    expect((await getTripRevision(owner.id, tripId)).viewers).toEqual([]);
    await getTripRevision(editor.id, tripId);
    // Never lists yourself.
    expect((await getTripRevision(owner.id, tripId)).viewers).toEqual([{ id: editor.id, name: "Editor" }]);
    expect((await getTripRevision(editor.id, tripId)).viewers).toEqual([{ id: owner.id, name: "Owner" }]);

    // Someone who stopped polling drops off.
    const db = await getDb();
    await db.update(s.tripPresence).set({ seenAt: new Date(Date.now() - 60_000) }).where(eq(s.tripPresence.userId, editor.id));
    expect((await getTripRevision(owner.id, tripId)).viewers).toEqual([]);
  });

  it("counts someone running an agent turn as viewing, though their tab stops polling", async () => {
    const tripId = await crewTrip();
    await claimTurn(editor.id, tripId);
    expect((await getTripRevision(owner.id, tripId)).viewers).toEqual([{ id: editor.id, name: "Editor" }]);
    await releaseTurn(tripId);
  });

  it("lets only the owner delete a trip", async () => {
    const tripId = await crewTrip();
    await expect(deleteTrip(editor.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteTrip(viewer.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteTrip(owner.id, tripId);
    await expect(getTripView(owner.id, tripId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("won't delete a trip while the agent is working on it", async () => {
    const tripId = await crewTrip();
    expect(await claimTurn(owner.id, tripId)).toBe(true);
    await expect(deleteTrip(owner.id, tripId)).rejects.toBeInstanceOf(ConflictError);
    await releaseTurn(tripId);
    await deleteTrip(owner.id, tripId);
  });
});

describe("versions and export", () => {
  it("needs an itinerary to save", async () => {
    const tripId = await crewTrip();
    await expect(saveVersion(owner.id, tripId)).rejects.toBeInstanceOf(ConflictError);
  });

  it("saves numbered snapshots, editors only", async () => {
    const tripId = await crewTrip(sampleItinerary());
    await expect(saveVersion(viewer.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await saveVersion(editor.id, tripId)).label).toBe("Version 1");
    expect((await saveVersion(editor.id, tripId, "  Final  ")).label).toBe("Final");
    expect((await saveVersion(editor.id, tripId, "   ")).label).toBe("Version 3");
    expect((await getTripView(viewer.id, tripId)).versions.map((v) => v.label)).toEqual(["Version 1", "Final", "Version 3"]);
  });

  it("snapshots don't change when the draft does", async () => {
    const tripId = await crewTrip(sampleItinerary());
    const v = await saveVersion(owner.id, tripId);
    await setTrip(tripId, { itinerary: { ...sampleItinerary(), title: "Changed" } });
    expect((await getItineraryForExport(owner.id, tripId, v.id))?.title).toBe("Kyoto Food Weekend");
    expect((await getItineraryForExport(owner.id, tripId, null))?.title).toBe("Changed");
  });

  it("won't export another trip's version", async () => {
    const a = await makeTrip(owner.id, sampleItinerary());
    const b = await makeTrip(owner.id, sampleItinerary());
    const v = await saveVersion(owner.id, a);
    expect(await getItineraryForExport(owner.id, b, v.id)).toBeNull();
    await expect(getItineraryForExport(outsider.id, a, v.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("agent turns", () => {
  const turn = (userId: string, overrides: Partial<TurnCommit> = {}): TurnCommit => ({
    userId,
    userText: "Plan Kyoto",
    reply: "Here you go",
    startSeq: 0,
    newMessages: [
      { role: "user", content: "[Owner] Plan Kyoto" },
      { role: "assistant", content: [{ type: "text", text: "Here you go" }] },
    ],
    itinerary: sampleItinerary(),
    commentReplies: [],
    commentsSeenAt: new Date(),
    ...overrides,
  });

  it("lets each person run one turn at a time, across all their trips", async () => {
    const u = await makeUser("OneAtATime");
    const [a, b] = [await makeTrip(u.id), await makeTrip(u.id)];
    await setTrip(a, { title: "Lisbon" });
    expect(await claimTurn(u.id, a)).toBe(true);

    await expect(claimTurn(u.id, b)).rejects.toThrow("PlanAway is still working on “Lisbon”");
    // A new trip would sit empty, so it's refused up front too.
    await expect(createTrip(u.id)).rejects.toBeInstanceOf(ConflictError);
    // Other people aren't held up by it.
    expect(await createTrip(outsider.id)).toHaveProperty("id");

    await releaseTurn(a);
    expect(await claimTurn(u.id, b)).toBe(true);
  });

  it("lets only one of two simultaneous requests through", async () => {
    const u = await makeUser("Racer");
    const [a, b] = [await makeTrip(u.id), await makeTrip(u.id)];
    const results = await Promise.allSettled([claimTurn(u.id, a), claimTurn(u.id, b)]);
    expect(results.filter((r) => r.status === "fulfilled" && r.value === true)).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("doesn't count a crashed turn's stale lock against the person", async () => {
    const u = await makeUser("Crashed");
    const [a, b] = [await makeTrip(u.id), await makeTrip(u.id)];
    await setTrip(a, { turnStartedAt: new Date(Date.now() - 16 * 60 * 1000), turnUserId: u.id });
    expect(await claimTurn(u.id, b)).toBe(true);
  });

  it("allows one turn at a time and shows who is busy", async () => {
    const tripId = await crewTrip();
    expect(await claimTurn(editor.id, tripId)).toBe(true);
    expect(await claimTurn(owner.id, tripId)).toBe(false);
    expect(await getTripRevision(viewer.id, tripId)).toMatchObject({ busy: { id: editor.id, name: "Editor" } });
    expect((await getTripView(viewer.id, tripId)).busy).toEqual({ id: editor.id, name: "Editor" });
    await releaseTurn(tripId);
    expect((await getTripRevision(viewer.id, tripId)).busy).toBeNull();
    expect(await claimTurn(owner.id, tripId)).toBe(true);
  });

  it("viewers can't run turns", async () => {
    const tripId = await crewTrip();
    await expect(claimTurn(viewer.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("takes over a stale lock from a crashed process", async () => {
    const tripId = await crewTrip();
    await setTrip(tripId, { turnStartedAt: new Date(Date.now() - 16 * 60 * 1000), turnUserId: editor.id });
    expect((await getTripRevision(owner.id, tripId)).busy).toBeNull();
    expect(await claimTurn(owner.id, tripId)).toBe(true);
  });

  it("commits chat, transcript, and itinerary, and names the trip", async () => {
    const tripId = await crewTrip();
    await commitTurn(tripId, turn(owner.id));
    const view = await getTripView(viewer.id, tripId);
    expect(view.title).toBe("Kyoto Food Weekend");
    expect(view.itinerary).toEqual(sampleItinerary());
    expect(view.chat.map((c) => [c.role, c.text, c.author?.name ?? null])).toEqual([
      ["user", "Plan Kyoto", "Owner"],
      ["assistant", "Here you go", null],
    ]);
    expect((await listTrips(owner.id)).find((t) => t.id === tripId)?.destinations).toEqual(["Kyoto", "Nara"]);
    expect((await loadTurnContext(tripId)).history).toHaveLength(2);
  });

  it("keeps a title people chose", async () => {
    const tripId = await crewTrip();
    await renameTrip(owner.id, tripId, "Our trip");
    await commitTurn(tripId, turn(owner.id));
    expect((await getTripView(owner.id, tripId)).title).toBe("Our trip");
  });

  it("appends transcript messages in order across turns", async () => {
    const tripId = await crewTrip();
    await commitTurn(tripId, turn(owner.id));
    await commitTurn(
      tripId,
      turn(owner.id, {
        startSeq: 2,
        newMessages: [
          { role: "user", content: "second" },
          { role: "assistant", content: [{ type: "text", text: "ok" }] },
        ],
      }),
    );
    const { history } = await loadTurnContext(tripId);
    expect(history.map((m) => m.content)).toEqual(["[Owner] Plan Kyoto", expect.anything(), "second", expect.anything()]);
  });

  it("rejects a commit that would overwrite transcript rows", async () => {
    const tripId = await crewTrip();
    await commitTurn(tripId, turn(owner.id));
    await expect(commitTurn(tripId, turn(owner.id, { reply: "dup" }))).rejects.toThrow();
    // The failed transaction left nothing behind.
    expect((await getTripView(owner.id, tripId)).chat).toHaveLength(2);
  });

  it("shows the agent new comments on open threads only, once", async () => {
    const tripId = await crewTrip(sampleItinerary());
    await addComment(viewer.id, tripId, { targetType: "activity", targetId: "a1", targetLabel: "Day 1 · Nishiki Market", body: "Too pricey" });
    await addComment(editor.id, tripId, { targetType: "day", targetId: "d2", targetLabel: "Day 2", body: "Settled already" });
    const view = await getTripView(owner.id, tripId);
    const [pricey, settled] = view.comments;
    await setThreadResolved(editor.id, tripId, settled.id, true);
    await addComment(editor.id, tripId, { parentId: pricey.id, body: "Agreed" });

    const ctx = await loadTurnContext(tripId);
    expect(ctx.newComments).toEqual([
      { threadId: pricey.id, author: "Viewer", targetLabel: "Day 1 · Nishiki Market", body: "Too pricey", isReply: false },
      { threadId: pricey.id, author: "Editor", targetLabel: "Day 1 · Nishiki Market", body: "Agreed", isReply: true },
    ]);
    expect([...ctx.openThreads]).toEqual([pricey.id]);

    // After the turn, the same comments aren't shown again.
    await commitTurn(tripId, turn(owner.id, { commentsSeenAt: ctx.startedAt }));
    expect((await loadTurnContext(tripId)).newComments).toEqual([]);
  });

  it("posts the agent's comment replies and resolves threads", async () => {
    const tripId = await crewTrip(sampleItinerary());
    await addComment(viewer.id, tripId, { targetType: "flight", targetId: "f1", targetLabel: "Flight SFO → KIX", body: "Cheaper?" });
    await addComment(viewer.id, tripId, { targetType: "trip", targetId: null, targetLabel: "Whole trip", body: "Love it" });
    const [flight, whole] = (await getTripView(owner.id, tripId)).comments;
    await addComment(viewer.id, tripId, { parentId: whole.id, body: "really" });
    const reply = (await getTripView(owner.id, tripId)).comments.find((c) => c.parentId === whole.id)!;

    await commitTurn(
      tripId,
      turn(owner.id, {
        commentReplies: [
          { threadId: flight.id, message: "  Switched to ZIPAIR  ", resolve: true },
          { threadId: whole.id, message: "", resolve: false },
          // A reply id is not a thread root, and must be ignored.
          { threadId: reply.id, message: "nope", resolve: true },
        ],
      }),
    );

    const comments = (await getTripView(owner.id, tripId)).comments;
    const agentReplies = comments.filter((c) => c.author === null);
    expect(agentReplies).toHaveLength(1);
    expect(agentReplies[0]).toMatchObject({ parentId: flight.id, body: "Switched to ZIPAIR", targetType: "flight", targetId: "f1" });
    expect(comments.find((c) => c.id === flight.id)?.resolvedAt).not.toBeNull();
    expect(comments.find((c) => c.id === whole.id)?.resolvedAt).toBeNull();
    expect(comments.find((c) => c.id === reply.id)?.resolvedAt).toBeNull();
  });
});

describe("comments", () => {
  async function thread(by: UserRef = viewer) {
    const tripId = await crewTrip(sampleItinerary());
    await addComment(by.id, tripId, { targetType: "day", targetId: "d1", targetLabel: "Day 1", body: "Too much walking" });
    const [root] = (await getTripView(owner.id, tripId)).comments;
    return { tripId, root };
  }

  it("lets viewers comment, and bumps the revision", async () => {
    const tripId = await crewTrip();
    const before = (await getTripRevision(owner.id, tripId)).revision;
    await addComment(viewer.id, tripId, { targetType: "trip", targetId: "ignored", targetLabel: "Whole trip", body: "Yay" });
    const [c] = (await getTripView(owner.id, tripId)).comments;
    expect(c).toMatchObject({ author: { id: viewer.id, name: "Viewer" }, targetType: "trip", targetId: null, body: "Yay" });
    expect((await getTripRevision(owner.id, tripId)).revision).toBe(before + 1);
  });

  it("keeps outsiders out", async () => {
    const { tripId, root } = await thread();
    await expect(addComment(outsider.id, tripId, { parentId: root.id, body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setThreadResolved(outsider.id, tripId, root.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteComment(outsider.id, tripId, root.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("replies inherit the thread's anchor and reopen it", async () => {
    const { tripId, root } = await thread();
    await setThreadResolved(editor.id, tripId, root.id, true);
    await addComment(owner.id, tripId, { parentId: root.id, body: "Actually, still too much" });
    const comments = (await getTripView(owner.id, tripId)).comments;
    expect(comments[0].resolvedAt).toBeNull();
    expect(comments[1]).toMatchObject({ parentId: root.id, targetType: "day", targetId: "d1", targetLabel: "Day 1" });
  });

  it("only allows replies to a thread root on the same trip", async () => {
    const { tripId, root } = await thread();
    await addComment(owner.id, tripId, { parentId: root.id, body: "reply" });
    const reply = (await getTripView(owner.id, tripId)).comments[1];
    await expect(addComment(owner.id, tripId, { parentId: reply.id, body: "nested" })).rejects.toBeInstanceOf(NotFoundError);

    const other = await thread();
    await expect(addComment(owner.id, tripId, { parentId: other.root.id, body: "cross-trip" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets editors and the author resolve, but not other viewers", async () => {
    const { tripId, root } = await thread(viewer);
    const otherViewer = await makeUser("Viewer2");
    await shareTrip(owner, tripId, otherViewer, "viewer");

    await expect(setThreadResolved(otherViewer.id, tripId, root.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setThreadResolved(viewer.id, tripId, root.id, true);
    let c = (await getTripView(owner.id, tripId)).comments[0];
    expect(c.resolvedBy).toBe(viewer.id);
    await setThreadResolved(editor.id, tripId, root.id, false);
    c = (await getTripView(owner.id, tripId)).comments[0];
    expect(c).toMatchObject({ resolvedAt: null, resolvedBy: null });
  });

  it("can't resolve a reply", async () => {
    const { tripId, root } = await thread();
    await addComment(owner.id, tripId, { parentId: root.id, body: "reply" });
    const reply = (await getTripView(owner.id, tripId)).comments[1];
    await expect(setThreadResolved(owner.id, tripId, reply.id, true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets authors and owners delete; deleting a root deletes its replies", async () => {
    const { tripId, root } = await thread(viewer);
    await addComment(editor.id, tripId, { parentId: root.id, body: "reply" });
    const reply = (await getTripView(owner.id, tripId)).comments[1];

    await expect(deleteComment(editor.id, tripId, root.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteComment(editor.id, tripId, reply.id);
    await addComment(editor.id, tripId, { parentId: root.id, body: "reply 2" });
    await deleteComment(owner.id, tripId, root.id);
    expect((await getTripView(owner.id, tripId)).comments).toEqual([]);
  });
});
