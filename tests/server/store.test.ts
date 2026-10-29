import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema as s } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  acceptInvite,
  addComment,
  claimTurn,
  commitTurn,
  createInvite,
  createTrip,
  createUser,
  deleteComment,
  deleteGroup,
  deleteTrip,
  getGroup,
  getInvite,
  getItineraryForExport,
  getTripRevision,
  getTripView,
  listGroups,
  loadTurnContext,
  releaseTurn,
  removeMember,
  renameGroup,
  renameTrip,
  requireRole,
  revokeInvite,
  saveVersion,
  setMemberRole,
  setThreadResolved,
  tripAccess,
  verifyCredentials,
  type TurnCommit,
  type UserRef,
} from "@/lib/store";
import { sampleItinerary } from "../fixtures";
import { getTripRow, makeGroup, makeTrip, makeUser, personalGroupId, setTrip } from "./helpers";

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

  it("only shows invites to owners", async () => {
    const g = await makeGroup(owner, [[editor, "editor"]]);
    // Links stay valid after use, so the one editor joined with is still listed.
    await createInvite(owner.id, g, "viewer");
    expect((await getGroup(owner.id, g)).invites.map((i) => i.role).sort()).toEqual(["editor", "viewer"]);
    expect((await getGroup(editor.id, g)).invites).toEqual([]);
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
    await expect(createInvite(u.id, g, "editor")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(u.id, g, u.id)).rejects.toThrow("can't leave your personal group");
  });
});

describe("invites", () => {
  it("lets people join at the invite's role", async () => {
    const g = await makeGroup(owner);
    const u = await makeUser("Joiner");
    const { token } = await createInvite(owner.id, g, "viewer");
    expect(await getInvite(token)).toEqual({ groupId: g, groupName: "Crew", role: "viewer" });
    expect(await acceptInvite(u.id, token)).toEqual({ groupId: g });
    expect((await getGroup(u.id, g)).role).toBe("viewer");
  });

  it("only owners can create or revoke invites", async () => {
    const g = await crew();
    await expect(createInvite(editor.id, g, "editor")).rejects.toBeInstanceOf(ForbiddenError);
    const { token } = await createInvite(owner.id, g, "editor");
    await expect(revokeInvite(editor.id, g, token)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps an existing member's role when they accept another invite", async () => {
    const g = await crew();
    const { token } = await createInvite(owner.id, g, "editor");
    await acceptInvite(viewer.id, token);
    expect((await getGroup(viewer.id, g)).role).toBe("viewer");
  });

  it("generates unguessable tokens that expire in 7 days", async () => {
    const g = await makeGroup(owner);
    const a = await createInvite(owner.id, g, "editor");
    const b = await createInvite(owner.id, g, "editor");
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    const days = (new Date(a.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
  });

  it("rejects revoked and expired invites", async () => {
    const g = await makeGroup(owner);
    const revoked = await createInvite(owner.id, g, "editor");
    await revokeInvite(owner.id, g, revoked.token);
    await expect(acceptInvite(outsider.id, revoked.token)).rejects.toBeInstanceOf(NotFoundError);

    const expired = await createInvite(owner.id, g, "editor");
    const db = await getDb();
    await db.update(s.groupInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.groupInvites.token, expired.token));
    await expect(getInvite(expired.token)).rejects.toBeInstanceOf(NotFoundError);
    await expect(acceptInvite(outsider.id, expired.token)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getGroup(owner.id, g)).invites).toEqual([]);
  });

  it("can't revoke another group's invite through your own group", async () => {
    const mine = await makeGroup(owner);
    const theirs = await makeGroup(editor);
    const { token } = await createInvite(editor.id, theirs, "viewer");
    await revokeInvite(owner.id, mine, token);
    expect(await getInvite(token)).toMatchObject({ groupId: theirs });
  });
});

describe("members", () => {
  it("lets owners change roles", async () => {
    const g = await crew();
    await setMemberRole(owner.id, g, viewer.id, "editor");
    expect((await getGroup(viewer.id, g)).role).toBe("editor");
    await expect(setMemberRole(editor.id, g, viewer.id, "owner")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps at least one owner", async () => {
    const g = await crew();
    await expect(setMemberRole(owner.id, g, owner.id, "editor")).rejects.toThrow("at least one owner");
    await expect(removeMember(owner.id, g, owner.id)).rejects.toThrow("at least one owner");
    // With a second owner, the first can step down.
    await setMemberRole(owner.id, g, editor.id, "owner");
    await setMemberRole(owner.id, g, owner.id, "viewer");
    expect((await getGroup(owner.id, g)).role).toBe("viewer");
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
    const g = (await getTripView(owner.id, tripId)).groupId;
    const { token } = await createInvite(owner.id, g, "viewer");
    await acceptInvite(otherViewer.id, token);

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
