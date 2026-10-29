import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import bcrypt from "bcryptjs";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema as s, type Db } from "./db";
import type { CommentTarget, Role } from "./db/schema";
import type { Itinerary } from "./itinerary";

export type { CommentTarget, Role };

// ---------- Errors and permissions ----------

export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
  }
}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function requireRole(role: Role, min: Role, action: string): void {
  if (RANK[role] < RANK[min]) throw new ForbiddenError(`You need ${min} access to ${action}.`);
}

/**
 * Who can delete a trip and decide who it's shared with: its group's owners
 * and its creator. Both need to be in the group; people a trip was shared
 * with (groupRole null) never can.
 */
function canManage(groupRole: Role | null, createdBy: string | null, userId: string): boolean {
  return groupRole === "owner" || (groupRole !== null && createdBy === userId);
}

/** A lock older than this is from a crashed process and can be taken over. */
const TURN_LOCK_MS = 15 * 60 * 1000;

/** Someone counts as viewing a trip if their tab polled this recently. Tabs
 *  poll every 4 seconds, so one late poll doesn't make them blink out. */
const PRESENCE_MS = 10_000;

// ---------- Shapes the API returns ----------

export interface UserRef {
  id: string;
  name: string;
}

export interface TripSummary {
  id: string;
  groupId: string;
  title: string;
  destinations: string[];
  updatedAt: string;
  hasItinerary: boolean;
  canDelete: boolean;
  /** Group owners and the trip's creator can share it and delete it. */
  canShare: boolean;
}

/** A trip someone shared with the user, outside any group they're in. */
export interface SharedTripSummary extends TripSummary {
  role: Role;
  sharedBy: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  personal: boolean;
  role: Role;
  memberCount: number;
  trips: TripSummary[];
}

export interface GroupDetail {
  id: string;
  name: string;
  personal: boolean;
  role: Role;
  members: (UserRef & { email: string; role: Role })[];
}

/** Who a trip is shared with. Only people who can share the trip see this. */
export interface TripSharing {
  invites: { token: string; role: Role; expiresAt: string | null }[];
  members: (UserRef & { email: string; role: Role })[];
}

/** What an invite link shows before anyone signs in. */
export interface InvitePreview {
  tripId: string;
  title: string;
  summary: string | null;
  destinations: string[];
  startDate: string | null;
  endDate: string | null;
  days: number;
  role: Role;
  invitedBy: string | null;
  expiresAt: string | null;
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  author: UserRef | null;
}

export interface SavedVersion {
  id: string;
  label: string;
  savedAt: string;
  savedBy: string | null;
  itinerary: Itinerary;
}

export interface CommentView {
  id: string;
  parentId: string | null;
  /** null means the comment came from the PlanAway agent. */
  author: UserRef | null;
  targetType: CommentTarget;
  targetId: string | null;
  targetLabel: string;
  body: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface TripView {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  role: Role;
  /** Group owners and the trip's creator can delete it. */
  canDelete: boolean;
  /** Same rule as canDelete. */
  canShare: boolean;
  /** Set when the user has this trip through an invite rather than its group. */
  sharedBy: UserRef | null;
  revision: number;
  itinerary: Itinerary | null;
  chat: ChatEntry[];
  versions: SavedVersion[];
  comments: CommentView[];
  /** Who is running an agent turn right now, if anyone. */
  busy: UserRef | null;
  updatedAt: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ---------- Users ----------

export async function createUser(name: string, email: string, password: string): Promise<UserRef> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, normalized));
    if (existing.length) throw new ConflictError("An account with that email already exists.");
    const [user] = await tx
      .insert(s.users)
      .values({ name: name.trim(), email: normalized, passwordHash })
      .returning({ id: s.users.id, name: s.users.name });
    const [group] = await tx
      .insert(s.groups)
      .values({ name: "Personal", personal: true, createdBy: user.id })
      .returning({ id: s.groups.id });
    await tx.insert(s.groupMembers).values({ groupId: group.id, userId: user.id, role: "owner" });
    return user;
  });
}

// Compared against when the email has no account, so the response time
// doesn't reveal which emails are registered.
let dummyHash: Promise<string> | undefined;

export async function verifyCredentials(email: string, password: string): Promise<(UserRef & { email: string }) | null> {
  const db = await getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.email, email.trim().toLowerCase()));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await (dummyHash ??= bcrypt.hash("not-a-password", 12))));
  return user && ok ? { id: user.id, name: user.name, email: user.email } : null;
}

// ---------- Groups ----------

async function groupRole(db: Db, groupId: string, userId: string): Promise<Role> {
  const [m] = await db
    .select({ role: s.groupMembers.role })
    .from(s.groupMembers)
    .where(and(eq(s.groupMembers.groupId, groupId), eq(s.groupMembers.userId, userId)));
  // Not a member looks the same as not existing, so ids don't leak.
  if (!m) throw new NotFoundError("Group not found");
  return m.role;
}

export async function listGroups(userId: string): Promise<GroupSummary[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: s.groups.id, name: s.groups.name, personal: s.groups.personal, role: s.groupMembers.role })
    .from(s.groupMembers)
    .innerJoin(s.groups, eq(s.groups.id, s.groupMembers.groupId))
    .where(eq(s.groupMembers.userId, userId))
    .orderBy(desc(s.groups.personal), asc(s.groups.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [trips, counts] = await Promise.all([
    db
      .select({
        id: s.trips.id,
        groupId: s.trips.groupId,
        title: s.trips.title,
        destinations: s.trips.destinations,
        updatedAt: s.trips.updatedAt,
        createdBy: s.trips.createdBy,
        hasItinerary: sql<boolean>`${s.trips.itinerary} is not null`,
      })
      .from(s.trips)
      .where(inArray(s.trips.groupId, ids))
      .orderBy(desc(s.trips.updatedAt)),
    db
      .select({ groupId: s.groupMembers.groupId, n: count() })
      .from(s.groupMembers)
      .where(inArray(s.groupMembers.groupId, ids))
      .groupBy(s.groupMembers.groupId),
  ]);
  return rows.map((g) => ({
    ...g,
    memberCount: counts.find((c) => c.groupId === g.id)?.n ?? 1,
    trips: trips
      .filter((t) => t.groupId === g.id)
      .map(({ createdBy, ...t }) => ({
        ...t,
        updatedAt: t.updatedAt.toISOString(),
        canDelete: canManage(g.role, createdBy, userId),
        canShare: canManage(g.role, createdBy, userId),
      })),
  }));
}

export async function createGroup(userId: string, name: string): Promise<{ id: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [group] = await tx.insert(s.groups).values({ name, createdBy: userId }).returning({ id: s.groups.id });
    await tx.insert(s.groupMembers).values({ groupId: group.id, userId, role: "owner" });
    return group;
  });
}

export async function getGroup(userId: string, groupId: string): Promise<GroupDetail> {
  const db = await getDb();
  const role = await groupRole(db, groupId, userId);
  const [group] = await db.select().from(s.groups).where(eq(s.groups.id, groupId));
  const members = await db
    .select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.groupMembers.role })
    .from(s.groupMembers)
    .innerJoin(s.users, eq(s.users.id, s.groupMembers.userId))
    .where(eq(s.groupMembers.groupId, groupId))
    .orderBy(asc(s.groupMembers.joinedAt));
  return { id: group.id, name: group.name, personal: group.personal, role, members };
}

export async function renameGroup(userId: string, groupId: string, name: string): Promise<void> {
  const db = await getDb();
  requireRole(await groupRole(db, groupId, userId), "owner", "rename this group");
  await db.update(s.groups).set({ name }).where(eq(s.groups.id, groupId));
}

export async function deleteGroup(userId: string, groupId: string): Promise<void> {
  const db = await getDb();
  requireRole(await groupRole(db, groupId, userId), "owner", "delete this group");
  const [group] = await db.select({ personal: s.groups.personal }).from(s.groups).where(eq(s.groups.id, groupId));
  if (group.personal) throw new ForbiddenError("Your personal group can't be deleted.");
  await db.delete(s.groups).where(eq(s.groups.id, groupId));
}

async function ownerCount(db: Db, groupId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(s.groupMembers)
    .where(and(eq(s.groupMembers.groupId, groupId), eq(s.groupMembers.role, "owner")));
  return n;
}

/** Owners change other members' roles. Nobody changes their own; owners hand over with transferOwnership. */
export async function setMemberRole(userId: string, groupId: string, memberId: string, role: Role): Promise<void> {
  const db = await getDb();
  requireRole(await groupRole(db, groupId, userId), "owner", "change roles");
  if (memberId === userId) {
    throw new ForbiddenError("You can't change your own role. To hand the group over, transfer ownership to another member.");
  }
  const current = await groupRole(db, groupId, memberId);
  if (current === "owner" && role !== "owner" && (await ownerCount(db, groupId)) === 1) {
    throw new ForbiddenError("A group needs at least one owner. Make someone else an owner first.");
  }
  await db
    .update(s.groupMembers)
    .set({ role })
    .where(and(eq(s.groupMembers.groupId, groupId), eq(s.groupMembers.userId, memberId)));
}

/** Makes another member the owner, and the current owner an editor, in one step. */
export async function transferOwnership(userId: string, groupId: string, newOwnerId: string): Promise<void> {
  const db = await getDb();
  requireRole(await groupRole(db, groupId, userId), "owner", "transfer ownership");
  if (newOwnerId === userId) throw new ConflictError("You're already an owner of this group.");
  const [group] = await db.select({ personal: s.groups.personal }).from(s.groups).where(eq(s.groups.id, groupId));
  if (group.personal) throw new ForbiddenError("Your personal group can't be transferred.");
  // Throws NotFound if they're not a member.
  await groupRole(db, groupId, newOwnerId);
  await db.transaction(async (tx) => {
    const member = (id: string) => and(eq(s.groupMembers.groupId, groupId), eq(s.groupMembers.userId, id));
    await tx.update(s.groupMembers).set({ role: "owner" }).where(member(newOwnerId));
    await tx.update(s.groupMembers).set({ role: "editor" }).where(member(userId));
  });
}

/** Owners can remove anyone; anyone can remove themselves (leave). */
export async function removeMember(userId: string, groupId: string, memberId: string): Promise<void> {
  const db = await getDb();
  const role = await groupRole(db, groupId, userId);
  if (memberId !== userId) requireRole(role, "owner", "remove members");
  const [group] = await db.select({ personal: s.groups.personal }).from(s.groups).where(eq(s.groups.id, groupId));
  if (group.personal) throw new ForbiddenError("You can't leave your personal group.");
  const memberRole = await groupRole(db, groupId, memberId);
  if (memberRole === "owner" && (await ownerCount(db, groupId)) === 1) {
    throw new ForbiddenError("A group needs at least one owner. Transfer ownership to another member first.");
  }
  await db
    .delete(s.groupMembers)
    .where(and(eq(s.groupMembers.groupId, groupId), eq(s.groupMembers.userId, memberId)));
}

// ---------- Trips ----------

/**
 * Loads a trip and the user's role on it: from its group, or from an invite
 * to this one trip, whichever is higher. Anyone with neither gets NotFound,
 * so trip ids don't leak.
 */
export async function tripAccess(userId: string, tripId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw new NotFoundError("Trip not found");
  const db = await getDb();
  const [row] = await db
    .select({ trip: s.trips, groupRole: s.groupMembers.role, tripRole: s.tripMembers.role, groupName: s.groups.name })
    .from(s.trips)
    .innerJoin(s.groups, eq(s.groups.id, s.trips.groupId))
    .leftJoin(s.groupMembers, and(eq(s.groupMembers.groupId, s.trips.groupId), eq(s.groupMembers.userId, userId)))
    .leftJoin(s.tripMembers, and(eq(s.tripMembers.tripId, s.trips.id), eq(s.tripMembers.userId, userId)))
    .where(eq(s.trips.id, tripId));
  const roles = [row?.groupRole, row?.tripRole].filter((r): r is Role => Boolean(r));
  if (!row || roles.length === 0) throw new NotFoundError("Trip not found");
  const role = roles.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  return { db, trip: row.trip, role, groupRole: row.groupRole, groupName: row.groupName };
}

/** tripAccess for changing who a trip is shared with. */
async function manageAccess(userId: string, tripId: string) {
  const access = await tripAccess(userId, tripId);
  if (!canManage(access.groupRole, access.trip.createdBy, userId)) {
    throw new ForbiddenError("Only the trip's creator or a group owner can share it.");
  }
  return access;
}

function bump(db: Db, tripId: string) {
  return db
    .update(s.trips)
    .set({ revision: sql`${s.trips.revision} + 1`, updatedAt: new Date() })
    .where(eq(s.trips.id, tripId));
}

function lockIsLive(startedAt: Date | null): boolean {
  return startedAt !== null && Date.now() - startedAt.getTime() < TURN_LOCK_MS;
}

export async function createTrip(userId: string, groupId: string): Promise<{ id: string }> {
  const db = await getDb();
  requireRole(await groupRole(db, groupId, userId), "editor", "create trips in this group");
  const [trip] = await db.insert(s.trips).values({ groupId, createdBy: userId }).returning({ id: s.trips.id });
  return trip;
}

export async function getTripView(userId: string, tripId: string): Promise<TripView> {
  const { db, trip, role, groupRole, groupName } = await tripAccess(userId, tripId);
  const [chat, versions, comments, busyUser, creator] = await Promise.all([
    db
      .select({ c: s.tripChat, authorName: s.users.name })
      .from(s.tripChat)
      .leftJoin(s.users, eq(s.users.id, s.tripChat.userId))
      .where(eq(s.tripChat.tripId, tripId))
      .orderBy(asc(s.tripChat.createdAt), asc(s.tripChat.role)),
    db.select().from(s.tripVersions).where(eq(s.tripVersions.tripId, tripId)).orderBy(asc(s.tripVersions.savedAt)),
    listComments(db, tripId),
    lockIsLive(trip.turnStartedAt) && trip.turnUserId
      ? db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.id, trip.turnUserId))
      : Promise.resolve([]),
    groupRole === null && trip.createdBy
      ? db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.id, trip.createdBy))
      : Promise.resolve([]),
  ]);
  return {
    id: trip.id,
    groupId: trip.groupId,
    groupName,
    title: trip.title,
    role,
    canDelete: canManage(groupRole, trip.createdBy, userId),
    canShare: canManage(groupRole, trip.createdBy, userId),
    sharedBy: groupRole === null ? (creator[0] ?? { id: "", name: "Former member" }) : null,
    revision: trip.revision,
    itinerary: trip.itinerary,
    chat: chat.map(({ c, authorName }) => ({
      id: c.id,
      role: c.role,
      text: c.text,
      at: c.createdAt.toISOString(),
      author: c.userId && authorName ? { id: c.userId, name: authorName } : null,
    })),
    versions: versions.map((v) => ({
      id: v.id,
      label: v.label,
      savedAt: v.savedAt.toISOString(),
      savedBy: v.savedBy,
      itinerary: v.itinerary,
    })),
    comments,
    busy: busyUser[0] ?? null,
    updatedAt: trip.updatedAt.toISOString(),
  };
}

/** Cheap check collaborators poll to learn whether to refetch. */
export async function getTripRevision(userId: string, tripId: string): Promise<{ revision: number; busy: UserRef | null; viewers: UserRef[] }> {
  const { db, trip } = await tripAccess(userId, tripId);
  let busy: UserRef | null = null;
  if (lockIsLive(trip.turnStartedAt) && trip.turnUserId) {
    [busy] = await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.id, trip.turnUserId));
  }
  // Polling doubles as a heartbeat: record this user, then list who else is here.
  await db
    .insert(s.tripPresence)
    .values({ tripId, userId, seenAt: new Date() })
    .onConflictDoUpdate({ target: [s.tripPresence.tripId, s.tripPresence.userId], set: { seenAt: new Date() } });
  const viewers = await db
    .select({ id: s.users.id, name: s.users.name })
    .from(s.tripPresence)
    .innerJoin(s.users, eq(s.users.id, s.tripPresence.userId))
    .where(and(eq(s.tripPresence.tripId, tripId), gt(s.tripPresence.seenAt, new Date(Date.now() - PRESENCE_MS))))
    .orderBy(asc(s.users.name));
  // A tab streaming its own turn stops polling, but its user is still here.
  if (busy && !viewers.some((v) => v.id === busy.id)) viewers.push(busy);
  return { revision: trip.revision, busy: busy ?? null, viewers: viewers.filter((v) => v.id !== userId) };
}

export async function renameTrip(userId: string, tripId: string, title: string): Promise<void> {
  const { db, role } = await tripAccess(userId, tripId);
  requireRole(role, "editor", "rename trips");
  await db.update(s.trips).set({ title }).where(eq(s.trips.id, tripId));
  await bump(db, tripId);
}

/** Group owners and the trip's creator can delete it. */
export async function deleteTrip(userId: string, tripId: string): Promise<void> {
  const { db, trip, groupRole } = await tripAccess(userId, tripId);
  if (!canManage(groupRole, trip.createdBy, userId)) {
    throw new ForbiddenError("Only the trip's creator or a group owner can delete it.");
  }
  if (lockIsLive(trip.turnStartedAt)) throw new ConflictError("The agent is still working on this trip.");
  await db.delete(s.trips).where(eq(s.trips.id, tripId));
}

export async function saveVersion(userId: string, tripId: string, label?: string): Promise<SavedVersion> {
  const { db, trip, role } = await tripAccess(userId, tripId);
  requireRole(role, "editor", "save versions");
  if (!trip.itinerary) throw new ConflictError("There is no itinerary to save yet.");
  const [{ n }] = await db.select({ n: count() }).from(s.tripVersions).where(eq(s.tripVersions.tripId, tripId));
  const [v] = await db
    .insert(s.tripVersions)
    .values({ tripId, label: label?.trim() || `Version ${n + 1}`, itinerary: trip.itinerary, savedBy: userId })
    .returning();
  await bump(db, tripId);
  return { id: v.id, label: v.label, savedAt: v.savedAt.toISOString(), savedBy: v.savedBy, itinerary: v.itinerary };
}

export async function getItineraryForExport(userId: string, tripId: string, versionId: string | null) {
  const { db, trip } = await tripAccess(userId, tripId);
  if (!versionId) return trip.itinerary;
  const [v] = await db
    .select({ itinerary: s.tripVersions.itinerary })
    .from(s.tripVersions)
    .where(and(eq(s.tripVersions.id, versionId), eq(s.tripVersions.tripId, tripId)));
  return v?.itinerary ?? null;
}

// ---------- Sharing one trip ----------

/** How long a new invite link lasts. null: until revoked. */
export const INVITE_EXPIRY_DAYS = [1, 7, 30, null] as const;
export type InviteExpiry = (typeof INVITE_EXPIRY_DAYS)[number];
export type InviteRole = Exclude<Role, "owner">;

const DAY_MS = 24 * 60 * 60 * 1000;
const inviteIsLive = () => or(isNull(s.tripInvites.expiresAt), gt(s.tripInvites.expiresAt, new Date()));

export async function createTripInvite(
  userId: string,
  tripId: string,
  role: InviteRole,
  expiresInDays: InviteExpiry,
): Promise<{ token: string; expiresAt: string | null }> {
  const { db } = await manageAccess(userId, tripId);
  // 192 random bits: unguessable, and the link is the only secret.
  const token = randomBytes(24).toString("base64url");
  const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY_MS);
  await db.insert(s.tripInvites).values({ token, tripId, role, createdBy: userId, expiresAt });
  return { token, expiresAt: iso(expiresAt) };
}

export async function getTripSharing(userId: string, tripId: string): Promise<TripSharing> {
  const { db } = await manageAccess(userId, tripId);
  const [invites, members] = await Promise.all([
    db
      .select({ token: s.tripInvites.token, role: s.tripInvites.role, expiresAt: s.tripInvites.expiresAt })
      .from(s.tripInvites)
      .where(and(eq(s.tripInvites.tripId, tripId), inviteIsLive()))
      .orderBy(desc(s.tripInvites.createdAt)),
    db
      .select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.tripMembers.role })
      .from(s.tripMembers)
      .innerJoin(s.users, eq(s.users.id, s.tripMembers.userId))
      .where(eq(s.tripMembers.tripId, tripId))
      .orderBy(asc(s.tripMembers.joinedAt)),
  ]);
  return { invites: invites.map((i) => ({ ...i, expiresAt: iso(i.expiresAt) })), members };
}

export async function revokeTripInvite(userId: string, tripId: string, token: string): Promise<void> {
  const { db } = await manageAccess(userId, tripId);
  await db.delete(s.tripInvites).where(and(eq(s.tripInvites.token, token), eq(s.tripInvites.tripId, tripId)));
}

export async function setTripMemberRole(userId: string, tripId: string, memberId: string, role: InviteRole): Promise<void> {
  const { db } = await manageAccess(userId, tripId);
  const updated = await db
    .update(s.tripMembers)
    .set({ role })
    .where(and(eq(s.tripMembers.tripId, tripId), eq(s.tripMembers.userId, memberId)))
    .returning({ userId: s.tripMembers.userId });
  if (updated.length === 0) throw new NotFoundError("That person doesn't have access to this trip.");
}

/** People who can share the trip can remove anyone; anyone can remove themselves (leave). */
export async function removeTripMember(userId: string, tripId: string, memberId: string): Promise<void> {
  const { db } = memberId === userId ? await tripAccess(userId, tripId) : await manageAccess(userId, tripId);
  await db.delete(s.tripMembers).where(and(eq(s.tripMembers.tripId, tripId), eq(s.tripMembers.userId, memberId)));
}

async function liveTripInvite(db: Db, token: string) {
  const [row] = await db
    .select({ invite: s.tripInvites, trip: s.trips, invitedBy: s.users.name })
    .from(s.tripInvites)
    .innerJoin(s.trips, eq(s.trips.id, s.tripInvites.tripId))
    .leftJoin(s.users, eq(s.users.id, s.tripInvites.createdBy))
    .where(and(eq(s.tripInvites.token, token), inviteIsLive()));
  if (!row) throw new NotFoundError("This invite link is invalid or has expired.");
  return row;
}

/** What the invite page shows. Needs no sign-in: holding the link is the permission. */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const { invite, trip, invitedBy } = await liveTripInvite(await getDb(), token);
  const it = trip.itinerary;
  return {
    tripId: trip.id,
    title: trip.title,
    summary: it?.summary ?? null,
    destinations: it?.destinations ?? trip.destinations,
    startDate: it?.start_date ?? null,
    endDate: it?.end_date ?? null,
    days: it?.days.length ?? 0,
    role: invite.role,
    invitedBy,
    expiresAt: iso(invite.expiresAt),
  };
}

/**
 * Gives the user access to the invite's one trip. People who already have it
 * through the trip's group are left as they are; people who were shared it
 * before keep the higher of their old role and the invite's.
 */
export async function acceptTripInvite(userId: string, token: string): Promise<{ tripId: string }> {
  const db = await getDb();
  const { invite, trip } = await liveTripInvite(db, token);
  const [inGroup] = await db
    .select({ role: s.groupMembers.role })
    .from(s.groupMembers)
    .where(and(eq(s.groupMembers.groupId, trip.groupId), eq(s.groupMembers.userId, userId)));
  if (!inGroup) {
    const insert = db.insert(s.tripMembers).values({ tripId: trip.id, userId, role: invite.role });
    // An editor link upgrades a viewer; a viewer link never downgrades an editor.
    await (invite.role === "editor"
      ? insert.onConflictDoUpdate({ target: [s.tripMembers.tripId, s.tripMembers.userId], set: { role: "editor" } })
      : insert.onConflictDoNothing());
  }
  return { tripId: trip.id };
}

/** Trips shared with the user one at a time, newest activity first. */
export async function listSharedTrips(userId: string): Promise<SharedTripSummary[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: s.trips.id,
      groupId: s.trips.groupId,
      title: s.trips.title,
      destinations: s.trips.destinations,
      updatedAt: s.trips.updatedAt,
      hasItinerary: sql<boolean>`${s.trips.itinerary} is not null`,
      role: s.tripMembers.role,
      sharedBy: s.users.name,
    })
    .from(s.tripMembers)
    .innerJoin(s.trips, eq(s.trips.id, s.tripMembers.tripId))
    .leftJoin(s.users, eq(s.users.id, s.trips.createdBy))
    // Trips the user can already see through a group are listed under it.
    .leftJoin(s.groupMembers, and(eq(s.groupMembers.groupId, s.trips.groupId), eq(s.groupMembers.userId, userId)))
    .where(and(eq(s.tripMembers.userId, userId), isNull(s.groupMembers.userId)))
    .orderBy(desc(s.trips.updatedAt));
  return rows.map((t) => ({
    ...t,
    updatedAt: t.updatedAt.toISOString(),
    sharedBy: t.sharedBy ?? "Former member",
    canDelete: false,
    canShare: false,
  }));
}

// ---------- Agent turns ----------

/**
 * Takes the trip's turn lock. Returns false if someone else's turn is running.
 * The lock lives in the database so it works across server instances.
 */
export async function claimTurn(userId: string, tripId: string): Promise<boolean> {
  const { db, role } = await tripAccess(userId, tripId);
  requireRole(role, "editor", "plan with the agent");
  const staleBefore = new Date(Date.now() - TURN_LOCK_MS);
  const claimed = await db
    .update(s.trips)
    .set({ turnStartedAt: new Date(), turnUserId: userId, revision: sql`${s.trips.revision} + 1` })
    .where(and(eq(s.trips.id, tripId), or(isNull(s.trips.turnStartedAt), lt(s.trips.turnStartedAt, staleBefore))))
    .returning({ id: s.trips.id });
  return claimed.length === 1;
}

export async function releaseTurn(tripId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(s.trips)
    .set({ turnStartedAt: null, turnUserId: null, revision: sql`${s.trips.revision} + 1` })
    .where(eq(s.trips.id, tripId));
}

export interface NewComment {
  threadId: string;
  author: string;
  targetLabel: string;
  body: string;
  isReply: boolean;
}

/** Everything the agent needs to run a turn. Call after claimTurn. */
export async function loadTurnContext(tripId: string) {
  const db = await getDb();
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, tripId));
  const [messages, fresh, open] = await Promise.all([
    db.select({ content: s.tripMessages.content }).from(s.tripMessages).where(eq(s.tripMessages.tripId, tripId)).orderBy(asc(s.tripMessages.seq)),
    db
      .select({ c: s.comments, authorName: s.users.name })
      .from(s.comments)
      .leftJoin(s.users, eq(s.users.id, s.comments.authorId))
      .where(and(eq(s.comments.tripId, tripId), gt(s.comments.createdAt, trip.commentsSeenAt), sql`${s.comments.authorId} is not null`))
      .orderBy(asc(s.comments.createdAt)),
    db
      .select({ id: s.comments.id })
      .from(s.comments)
      .where(and(eq(s.comments.tripId, tripId), isNull(s.comments.parentId), isNull(s.comments.resolvedAt))),
  ]);
  const openThreads = new Set(open.map((o) => o.id));
  const newComments: NewComment[] = fresh
    .filter(({ c }) => openThreads.has(c.parentId ?? c.id))
    .map(({ c, authorName }) => ({
      threadId: c.parentId ?? c.id,
      author: authorName ?? "Someone",
      targetLabel: c.targetLabel,
      body: c.body,
      isReply: c.parentId !== null,
    }));
  return {
    history: messages.map((m) => m.content),
    itinerary: trip.itinerary,
    title: trip.title,
    newComments,
    openThreads,
    startedAt: new Date(),
  };
}

export interface TurnCommit {
  userId: string;
  userText: string;
  reply: string;
  startSeq: number;
  newMessages: Anthropic.Beta.BetaMessageParam[];
  itinerary: Itinerary | null;
  commentReplies: { threadId: string; message: string; resolve: boolean }[];
  commentsSeenAt: Date;
}

/** Saves a completed turn atomically. Nothing from a failed turn is ever written. */
export async function commitTurn(tripId: string, turn: TurnCommit): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId));
    if (turn.newMessages.length) {
      await tx.insert(s.tripMessages).values(turn.newMessages.map((content, i) => ({ tripId, seq: turn.startSeq + i, content })));
    }
    const now = Date.now();
    await tx.insert(s.tripChat).values([
      { tripId, userId: turn.userId, role: "user", text: turn.userText, createdAt: new Date(now) },
      { tripId, userId: null, role: "assistant", text: turn.reply, createdAt: new Date(now + 1) },
    ]);
    for (const r of turn.commentReplies) {
      const [root] = await tx
        .select()
        .from(s.comments)
        .where(and(eq(s.comments.id, r.threadId), eq(s.comments.tripId, tripId), isNull(s.comments.parentId)));
      if (!root) continue;
      if (r.message.trim()) {
        await tx.insert(s.comments).values({
          tripId,
          parentId: root.id,
          authorId: null,
          targetType: root.targetType,
          targetId: root.targetId,
          targetLabel: root.targetLabel,
          body: r.message.trim(),
        });
      }
      if (r.resolve) await tx.update(s.comments).set({ resolvedAt: new Date(), resolvedBy: null }).where(eq(s.comments.id, root.id));
    }
    const it = turn.itinerary;
    await tx
      .update(s.trips)
      .set({
        itinerary: it,
        destinations: it?.destinations ?? [],
        title: it && trip.title === "New trip" ? it.title : trip.title,
        commentsSeenAt: turn.commentsSeenAt,
        revision: sql`${s.trips.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.trips.id, tripId));
  });
}

// ---------- Comments ----------

async function listComments(db: Db, tripId: string): Promise<CommentView[]> {
  const rows = await db
    .select({ c: s.comments, authorName: s.users.name })
    .from(s.comments)
    .leftJoin(s.users, eq(s.users.id, s.comments.authorId))
    .where(eq(s.comments.tripId, tripId))
    .orderBy(asc(s.comments.createdAt));
  return rows.map(({ c, authorName }) => ({
    id: c.id,
    parentId: c.parentId,
    author: c.authorId ? { id: c.authorId, name: authorName ?? "Former member" } : null,
    targetType: c.targetType,
    targetId: c.targetId,
    targetLabel: c.targetLabel,
    body: c.body,
    resolvedAt: iso(c.resolvedAt),
    resolvedBy: c.resolvedBy,
    createdAt: c.createdAt.toISOString(),
  }));
}

export type CommentInput =
  | { parentId: string; body: string }
  | { parentId?: undefined; targetType: CommentTarget; targetId: string | null; targetLabel: string; body: string };

/** Any member, viewers included, can comment. Replying reopens a resolved thread. */
export async function addComment(userId: string, tripId: string, input: CommentInput): Promise<void> {
  const { db } = await tripAccess(userId, tripId);
  if (input.parentId !== undefined) {
    const [root] = await db
      .select()
      .from(s.comments)
      .where(and(eq(s.comments.id, input.parentId), eq(s.comments.tripId, tripId), isNull(s.comments.parentId)));
    if (!root) throw new NotFoundError("Comment thread not found");
    await db.insert(s.comments).values({
      tripId,
      parentId: root.id,
      authorId: userId,
      targetType: root.targetType,
      targetId: root.targetId,
      targetLabel: root.targetLabel,
      body: input.body,
    });
    if (root.resolvedAt) await db.update(s.comments).set({ resolvedAt: null, resolvedBy: null }).where(eq(s.comments.id, root.id));
  } else {
    await db.insert(s.comments).values({
      tripId,
      authorId: userId,
      targetType: input.targetType,
      targetId: input.targetType === "trip" ? null : input.targetId,
      targetLabel: input.targetLabel,
      body: input.body,
    });
  }
  await bump(db, tripId);
}

async function threadRoot(db: Db, tripId: string, commentId: string) {
  const [c] = await db.select().from(s.comments).where(and(eq(s.comments.id, commentId), eq(s.comments.tripId, tripId)));
  if (!c) throw new NotFoundError("Comment not found");
  return c;
}

/** Editors and the thread's author can resolve or reopen a thread. */
export async function setThreadResolved(userId: string, tripId: string, threadId: string, resolved: boolean): Promise<void> {
  const { db, role } = await tripAccess(userId, tripId);
  const root = await threadRoot(db, tripId, threadId);
  if (root.parentId) throw new NotFoundError("Comment thread not found");
  if (root.authorId !== userId) requireRole(role, "editor", "resolve other people's comments");
  await db
    .update(s.comments)
    .set(resolved ? { resolvedAt: new Date(), resolvedBy: userId } : { resolvedAt: null, resolvedBy: null })
    .where(eq(s.comments.id, threadId));
  await bump(db, tripId);
}

/** Authors can delete their own comments; group owners can delete any. Deleting a thread's first comment deletes the thread. */
export async function deleteComment(userId: string, tripId: string, commentId: string): Promise<void> {
  const { db, role } = await tripAccess(userId, tripId);
  const c = await threadRoot(db, tripId, commentId);
  if (c.authorId !== userId) requireRole(role, "owner", "delete other people's comments");
  await db.delete(s.comments).where(eq(s.comments.id, commentId));
  await bump(db, tripId);
}
