import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
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
  deleteGroup,
  deleteTrip,
  getGroup,
  getInvitePreview,
  getItineraryForExport,
  getTripRevision,
  getTripSharing,
  getTripView,
  listGroups,
  listSharedTrips,
  loadTurnContext,
  releaseTurn,
  removeMember,
  removeTripMember,
  renameGroup,
  renameTrip,
  requireRole,
  revokeTripInvite,
  saveVersion,
  setMemberRole,
  setTripMemberRole,
  transferOwnership,
  setThreadResolved,
  tripAccess,
  verifyCredentials,
  type TurnCommit,
  type UserRef,
} from "@/lib/store";
import { sampleItinerary } from "../fixtures";
import { getTripRow, makeGroup, makeTrip, makeUser, personalGroupId, setTrip, shareTrip } from "./helpers";

// One cast of characters for the whole file; each test makes its own groups
// and trips so tests don't depend on each other.
let owner: UserRef, editor: UserRef, viewer: UserRef, outsider: UserRef;

beforeAll(async () => {
  [owner, editor, viewer, outsider] = await Promise.all([makeUser("Owner"), makeUser("Editor"), makeUser("Viewer"), makeUser("Outsider")]);
});

const crew = () =>
  makeGroup(owner, [
    [editor, "editor"],
    [viewer, "viewer"],
  ]);

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
  it("creates a personal group owned by the new user", async () => {
    const u = await makeUser("Solo");
    const groups = await listGroups(u.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: "Personal", personal: true, role: "owner", memberCount: 1, trips: [] });
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

describe("groups", () => {
  it("lists the personal group first, with member counts and trips", async () => {
    const u = await makeUser("Lister");
    const shared = await makeGroup(u, [[outsider, "viewer"]], "Ski crew");
    const tripId = await makeTrip(u.id, shared);
    const groups = await listGroups(u.id);
    expect(groups.map((g) => g.name)).toEqual(["Personal", "Ski crew"]);
    expect(groups[1]).toMatchObject({ memberCount: 2, role: "owner", trips: [{ id: tripId, title: "New trip" }] });
  });

  it("says which listed trips have an itinerary and which the user can delete", async () => {
    const g = await makeGroup(owner, [[editor, "editor"]]);
    const mine = await makeTrip(editor.id, g, sampleItinerary());
    const theirs = await makeTrip(owner.id, g);
    const summary = async (userId: string, tripId: string) =>
      (await listGroups(userId)).find((x) => x.id === g)!.trips.find((t) => t.id === tripId);

    expect(await summary(editor.id, mine)).toMatchObject({ hasItinerary: true, canDelete: true });
    expect(await summary(editor.id, theirs)).toMatchObject({ hasItinerary: false, canDelete: false });
    expect(await summary(owner.id, mine)).toMatchObject({ canDelete: true });
    expect(await summary(editor.id, mine)).not.toHaveProperty("createdBy");
  });

  it("hides groups from non-members as not found", async () => {
    const g = await crew();
    await expect(getGroup(outsider.id, g)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets only owners rename and delete", async () => {
    const g = await crew();
    await expect(renameGroup(editor.id, g, "Mine now")).rejects.toBeInstanceOf(ForbiddenError);
    await renameGroup(owner.id, g, "Renamed");
    expect((await getGroup(owner.id, g)).name).toBe("Renamed");
    await expect(deleteGroup(editor.id, g)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteGroup(owner.id, g);
    await expect(getGroup(owner.id, g)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleting a group deletes its trips", async () => {
    const g = await crew();
    const tripId = await makeTrip(owner.id, g);
    await deleteGroup(owner.id, g);
    expect(await getTripRow(tripId)).toBeUndefined();
  });

  it("protects the personal group", async () => {
    const u = await makeUser("Personal");
    const g = await personalGroupId(u.id);
    await expect(deleteGroup(u.id, g)).rejects.toThrow("can't be deleted");
    await expect(removeMember(u.id, g, u.id)).rejects.toThrow("can't leave your personal group");
  });
});

describe("sharing one trip", () => {
  it("creates unguessable links with a chosen expiry, or none", async () => {
    const tripId = await makeTrip(owner.id, await crew(), sampleItinerary());
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
    const tripId = await makeTrip(owner.id, await crew(), sampleItinerary());
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

  it("gives access to that one trip only, not the rest of the group", async () => {
    const g = await crew();
    const sharedTrip = await makeTrip(owner.id, g, sampleItinerary());
    const otherTrip = await makeTrip(owner.id, g);
    const guest = await makeUser("Guest");
    await expect(getTripView(guest.id, sharedTrip)).rejects.toBeInstanceOf(NotFoundError);

    const { token } = await createTripInvite(owner.id, sharedTrip, "viewer", 7);
    expect(await acceptTripInvite(guest.id, token)).toEqual({ tripId: sharedTrip });

    expect(await getTripView(guest.id, sharedTrip)).toMatchObject({
      role: "viewer",
      canShare: false,
      canDelete: false,
      sharedBy: { id: owner.id, name: "Owner" },
    });
    await expect(getTripView(guest.id, otherTrip)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getGroup(guest.id, g)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listGroups(guest.id)).map((x) => x.name)).toEqual(["Personal"]);
    expect(await listSharedTrips(guest.id)).toMatchObject([{ id: sharedTrip, role: "viewer", sharedBy: "Owner", hasItinerary: true }]);
  });

  it("lets editors change the plan and viewers only view and comment", async () => {
    const tripId = await makeTrip(owner.id, await makeGroup(owner), sampleItinerary());
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

  it("lets a trip's creator or a group owner share it, but not other group members", async () => {
    const g = await crew();
    const ownersTrip = await makeTrip(owner.id, g);
    const editorsTrip = await makeTrip(editor.id, g);
    await expect(createTripInvite(editor.id, ownersTrip, "viewer", 7)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTripInvite(viewer.id, ownersTrip, "viewer", 7)).rejects.toBeInstanceOf(ForbiddenError);
    await createTripInvite(editor.id, editorsTrip, "viewer", 7);
    await createTripInvite(owner.id, editorsTrip, "viewer", 7);
    await expect(getTripSharing(viewer.id, ownersTrip)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("can share trips from a personal group", async () => {
    const tripId = await makeTrip(owner.id, await personalGroupId(owner.id));
    const friend = await makeUser("Friend");
    await shareTrip(owner, tripId, friend, "editor");
    expect((await getTripView(friend.id, tripId)).role).toBe("editor");
  });

  it("rejects revoked and expired links", async () => {
    const tripId = await makeTrip(owner.id, await crew());
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
    const mine = await makeTrip(owner.id, await makeGroup(owner));
    const theirs = await makeTrip(editor.id, await makeGroup(editor));
    const { token } = await createTripInvite(editor.id, theirs, "viewer", 7);
    await revokeTripInvite(owner.id, mine, token);
    expect(await getInvitePreview(token)).toMatchObject({ tripId: theirs });
  });

  it("upgrades a viewer who opens an editor link, and never downgrades", async () => {
    const tripId = await makeTrip(owner.id, await makeGroup(owner));
    const u = await makeUser("Upgrade");
    await shareTrip(owner, tripId, u, "viewer");
    await shareTrip(owner, tripId, u, "editor");
    expect((await getTripView(u.id, tripId)).role).toBe("editor");
    await shareTrip(owner, tripId, u, "viewer");
    expect((await getTripView(u.id, tripId)).role).toBe("editor");
  });

  it("leaves group members' access alone when they open a link", async () => {
    const g = await crew();
    const tripId = await makeTrip(owner.id, g);
    await shareTrip(owner, tripId, viewer, "editor");
    expect((await getTripView(viewer.id, tripId)).role).toBe("viewer");
    expect((await getTripSharing(owner.id, tripId)).members).toEqual([]);
    expect(await listSharedTrips(viewer.id)).toEqual([]);
  });

  it("lets the sharer change roles and remove people, and people leave", async () => {
    const tripId = await makeTrip(owner.id, await makeGroup(owner));
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
    expect(await listSharedTrips(b.id)).toEqual([]);
  });

  it("deleting the trip removes its links and shared access", async () => {
    const tripId = await makeTrip(owner.id, await makeGroup(owner));
    const u = await makeUser("Gone");
    const { token } = await createTripInvite(owner.id, tripId, "viewer", null);
    await acceptTripInvite(u.id, token);
    await deleteTrip(owner.id, tripId);
    expect(await listSharedTrips(u.id)).toEqual([]);
    await expect(getInvitePreview(token)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("members", () => {
  it("lets owners change roles", async () => {
    const g = await crew();
    await setMemberRole(owner.id, g, viewer.id, "editor");
    expect((await getGroup(viewer.id, g)).role).toBe("editor");
    await expect(setMemberRole(editor.id, g, viewer.id, "owner")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never lets anyone change their own role, even with another owner", async () => {
    const g = await crew();
    await expect(setMemberRole(owner.id, g, owner.id, "editor")).rejects.toThrow("transfer ownership");
    await setMemberRole(owner.id, g, editor.id, "owner");
    await expect(setMemberRole(owner.id, g, owner.id, "viewer")).rejects.toThrow("transfer ownership");
    expect((await getGroup(owner.id, g)).role).toBe("owner");
  });

  it("transfers ownership: the new owner takes over and the old one becomes an editor", async () => {
    const g = await crew();
    await transferOwnership(owner.id, g, viewer.id);
    expect((await getGroup(viewer.id, g)).role).toBe("owner");
    expect((await getGroup(owner.id, g)).role).toBe("editor");
    // The former owner can't take it back on their own.
    await expect(transferOwnership(owner.id, g, owner.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setMemberRole(owner.id, g, owner.id, "owner")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only transfers to a member, from an owner, outside personal groups", async () => {
    const g = await crew();
    await expect(transferOwnership(editor.id, g, viewer.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(transferOwnership(owner.id, g, outsider.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(transferOwnership(owner.id, g, owner.id)).rejects.toBeInstanceOf(ConflictError);
    const u = await makeUser("Solo2");
    await expect(transferOwnership(u.id, await personalGroupId(u.id), outsider.id)).rejects.toThrow("can't be transferred");
    expect((await getGroup(owner.id, g)).role).toBe("owner");
  });

  it("won't let the last owner leave", async () => {
    const g = await crew();
    await expect(removeMember(owner.id, g, owner.id)).rejects.toThrow("Transfer ownership");
  });

  it("lets anyone leave, but only owners remove others", async () => {
    const g = await crew();
    await expect(removeMember(editor.id, g, viewer.id)).rejects.toBeInstanceOf(ForbiddenError);
    await removeMember(viewer.id, g, viewer.id);
    await expect(getGroup(viewer.id, g)).rejects.toBeInstanceOf(NotFoundError);
    await removeMember(owner.id, g, editor.id);
    expect((await getGroup(owner.id, g)).members.map((m) => m.id)).toEqual([owner.id]);
  });

  it("treats non-members as not found", async () => {
    const g = await crew();
    await expect(setMemberRole(owner.id, g, outsider.id, "editor")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("trips", () => {
  it("requires editor access to create a trip", async () => {
    const g = await crew();
    await expect(createTrip(viewer.id, g)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTrip(outsider.id, g)).rejects.toBeInstanceOf(NotFoundError);
    expect(await createTrip(editor.id, g)).toHaveProperty("id");
  });

  it("returns a full view to members and not found to everyone else", async () => {
    const g = await crew();
    const tripId = await makeTrip(editor.id, g, sampleItinerary());
    const view = await getTripView(viewer.id, tripId);
    expect(view).toMatchObject({ id: tripId, groupId: g, groupName: "Crew", role: "viewer", canDelete: false, busy: null });
    expect(view.itinerary).toEqual(sampleItinerary());
    await expect(getTripView(outsider.id, tripId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects malformed trip ids before querying", async () => {
    await expect(tripAccess(owner.id, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(tripAccess(owner.id, "'; drop table trips; --")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("renaming requires editor and bumps the revision", async () => {
    const g = await crew();
    const tripId = await makeTrip(owner.id, g);
    await expect(renameTrip(viewer.id, tripId, "Mine")).rejects.toBeInstanceOf(ForbiddenError);
    const before = (await getTripRevision(owner.id, tripId)).revision;
    await renameTrip(editor.id, tripId, "Spring break");
    expect((await getTripRevision(owner.id, tripId)).revision).toBeGreaterThan(before);
    expect((await getTripView(owner.id, tripId)).title).toBe("Spring break");
  });

  it("reports who else has a trip open, from recent polls", async () => {
    const tripId = await makeTrip(owner.id, await crew());
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
    const tripId = await makeTrip(owner.id, await crew());
    await claimTurn(editor.id, tripId);
    expect((await getTripRevision(owner.id, tripId)).viewers).toEqual([{ id: editor.id, name: "Editor" }]);
    await releaseTurn(tripId);
  });

  it("lets the creator or an owner delete a trip", async () => {
    const g = await crew();
    const byOwner = await makeTrip(owner.id, g);
    await expect(deleteTrip(editor.id, byOwner)).rejects.toBeInstanceOf(ForbiddenError);
    const byEditor = await makeTrip(editor.id, g);
    expect((await getTripView(editor.id, byEditor)).canDelete).toBe(true);
    await deleteTrip(editor.id, byEditor);
    await deleteTrip(owner.id, byOwner);
    await expect(getTripView(owner.id, byOwner)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("won't delete a trip while the agent is working on it", async () => {
    const tripId = await makeTrip(owner.id, await crew());
    expect(await claimTurn(owner.id, tripId)).toBe(true);
    await expect(deleteTrip(owner.id, tripId)).rejects.toBeInstanceOf(ConflictError);
    await releaseTurn(tripId);
    await deleteTrip(owner.id, tripId);
  });
});

describe("versions and export", () => {
  it("needs an itinerary to save", async () => {
    const tripId = await makeTrip(owner.id, await crew());
    await expect(saveVersion(owner.id, tripId)).rejects.toBeInstanceOf(ConflictError);
  });

  it("saves numbered snapshots, editors only", async () => {
    const tripId = await makeTrip(owner.id, await crew(), sampleItinerary());
    await expect(saveVersion(viewer.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await saveVersion(editor.id, tripId)).label).toBe("Version 1");
    expect((await saveVersion(editor.id, tripId, "  Final  ")).label).toBe("Final");
    expect((await saveVersion(editor.id, tripId, "   ")).label).toBe("Version 3");
    expect((await getTripView(viewer.id, tripId)).versions.map((v) => v.label)).toEqual(["Version 1", "Final", "Version 3"]);
  });

  it("snapshots don't change when the draft does", async () => {
    const tripId = await makeTrip(owner.id, await crew(), sampleItinerary());
    const v = await saveVersion(owner.id, tripId);
    await setTrip(tripId, { itinerary: { ...sampleItinerary(), title: "Changed" } });
    expect((await getItineraryForExport(owner.id, tripId, v.id))?.title).toBe("Kyoto Food Weekend");
    expect((await getItineraryForExport(owner.id, tripId, null))?.title).toBe("Changed");
  });

  it("won't export another trip's version", async () => {
    const g = await crew();
    const a = await makeTrip(owner.id, g, sampleItinerary());
    const b = await makeTrip(owner.id, g, sampleItinerary());
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

  it("allows one turn at a time and shows who is busy", async () => {
    const tripId = await makeTrip(owner.id, await crew());
    expect(await claimTurn(editor.id, tripId)).toBe(true);
    expect(await claimTurn(owner.id, tripId)).toBe(false);
    expect(await getTripRevision(viewer.id, tripId)).toMatchObject({ busy: { id: editor.id, name: "Editor" } });
    expect((await getTripView(viewer.id, tripId)).busy).toEqual({ id: editor.id, name: "Editor" });
    await releaseTurn(tripId);
    expect((await getTripRevision(viewer.id, tripId)).busy).toBeNull();
    expect(await claimTurn(owner.id, tripId)).toBe(true);
  });

  it("viewers can't run turns", async () => {
    const tripId = await makeTrip(owner.id, await crew());
    await expect(claimTurn(viewer.id, tripId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("takes over a stale lock from a crashed process", async () => {
    const tripId = await makeTrip(owner.id, await crew());
    await setTrip(tripId, { turnStartedAt: new Date(Date.now() - 16 * 60 * 1000), turnUserId: editor.id });
    expect((await getTripRevision(owner.id, tripId)).busy).toBeNull();
    expect(await claimTurn(owner.id, tripId)).toBe(true);
  });

  it("commits chat, transcript, and itinerary, and names the trip", async () => {
    const tripId = await makeTrip(owner.id, await crew());
    await commitTurn(tripId, turn(owner.id));
    const view = await getTripView(viewer.id, tripId);
    expect(view.title).toBe("Kyoto Food Weekend");
    expect(view.itinerary).toEqual(sampleItinerary());
    expect(view.chat.map((c) => [c.role, c.text, c.author?.name ?? null])).toEqual([
      ["user", "Plan Kyoto", "Owner"],
      ["assistant", "Here you go", null],
    ]);
    expect((await listGroups(owner.id)).flatMap((g) => g.trips).find((t) => t.id === tripId)?.destinations).toEqual(["Kyoto", "Nara"]);
    expect((await loadTurnContext(tripId)).history).toHaveLength(2);
  });

  it("keeps a title the group chose", async () => {
    const tripId = await makeTrip(owner.id, await crew());
    await renameTrip(owner.id, tripId, "Our trip");
    await commitTurn(tripId, turn(owner.id));
    expect((await getTripView(owner.id, tripId)).title).toBe("Our trip");
  });

  it("appends transcript messages in order across turns", async () => {
    const tripId = await makeTrip(owner.id, await crew());
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
    const tripId = await makeTrip(owner.id, await crew());
    await commitTurn(tripId, turn(owner.id));
    await expect(commitTurn(tripId, turn(owner.id, { reply: "dup" }))).rejects.toThrow();
    // The failed transaction left nothing behind.
    expect((await getTripView(owner.id, tripId)).chat).toHaveLength(2);
  });

  it("shows the agent new comments on open threads only, once", async () => {
    const tripId = await makeTrip(owner.id, await crew(), sampleItinerary());
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
    const tripId = await makeTrip(owner.id, await crew(), sampleItinerary());
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
    const tripId = await makeTrip(owner.id, await crew(), sampleItinerary());
    await addComment(by.id, tripId, { targetType: "day", targetId: "d1", targetLabel: "Day 1", body: "Too much walking" });
    const [root] = (await getTripView(owner.id, tripId)).comments;
    return { tripId, root };
  }

  it("lets viewers comment, and bumps the revision", async () => {
    const tripId = await makeTrip(owner.id, await crew());
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
