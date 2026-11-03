import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import bcrypt from "bcryptjs";
import { and, asc, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { birthDateProblem, passwordProblem } from "./account";
import { getDb, schema as s, type Db } from "./db";
import type { CommentTarget, Role } from "./db/schema";
import type { Itinerary } from "./itinerary";
import { parseSettings, type UserSettings } from "./settings";

export type { CommentTarget, Role };

// ---------- Errors and permissions ----------

export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
  }
}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
/** Input the route couldn't check up front, e.g. an image's real size. */
export class InvalidInputError extends Error {}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function requireRole(role: Role, min: Role, action: string): void {
  if (RANK[role] < RANK[min]) throw new ForbiddenError(`You need ${min} access to ${action}.`);
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

/** Someone with the trip open, with their profile photo if they have one. */
export interface Viewer extends UserRef {
  avatarUrl: string | null;
}

/** The signed-in user's own account, for the app and the settings page. */
export interface Profile extends Viewer {
  email: string;
  /** YYYY-MM-DD, or null for accounts made before it was asked. */
  birthDate: string | null;
  settings: UserSettings;
}

export interface TripSummary {
  id: string;
  title: string;
  destinations: string[];
  updatedAt: string;
  hasItinerary: boolean;
  /** The itinerary's first day (YYYY-MM-DD), or null before it has dates. */
  startDate: string | null;
  /** When the trip was marked completed; null for trips still ahead. */
  completedAt: string | null;
  /** owner for the user's own trips; editor or viewer for trips shared with them. */
  role: Role;
  /** Who shared it with the user; null for their own trips. */
  sharedBy: string | null;
}

/** Who a trip is shared with. Only the trip's owner sees this. */
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
  /** null for PlanAway's comments, and for people who have deleted their account. */
  author: UserRef | null;
  /** Written by PlanAway. */
  byAgent: boolean;
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
  title: string;
  /** owner means the user created the trip, and can share and delete it. */
  role: Role;
  /** The trip's owner, when that's someone else. */
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

/** The register route requires a valid birthDate; it's optional here for tests and older callers. */
export async function createUser(name: string, email: string, password: string, birthDate: string | null = null): Promise<UserRef> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, normalized));
    if (existing.length) throw new ConflictError("An account with that email already exists.");
    const [user] = await tx
      .insert(s.users)
      .values({ name: name.trim(), email: normalized, passwordHash, birthDate })
      .returning({ id: s.users.id, name: s.users.name });
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

// ---------- Profile and settings ----------

/** Largest profile photo accepted, decoded. The browser shrinks photos well below this. */
const MAX_AVATAR_BYTES = 300 * 1024;
const AVATAR_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Where a photo is served. The version changes with the photo, so it can be cached for good. */
const avatarUrl = (userId: string, updatedAt: Date | null) => (updatedAt ? `/api/avatars/${userId}?v=${updatedAt.getTime()}` : null);

export async function getProfile(userId: string): Promise<Profile> {
  const db = await getDb();
  const [u] = await db
    .select({
      id: s.users.id,
      name: s.users.name,
      email: s.users.email,
      birthDate: s.users.birthDate,
      avatarUpdatedAt: s.users.avatarUpdatedAt,
      settings: s.users.settings,
    })
    .from(s.users)
    .where(eq(s.users.id, userId));
  if (!u) throw new NotFoundError("Account not found");
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    birthDate: u.birthDate,
    avatarUrl: avatarUrl(u.id, u.avatarUpdatedAt),
    settings: parseSettings(u.settings),
  };
}

export async function setBirthDate(userId: string, birthDate: string): Promise<void> {
  const problem = birthDateProblem(birthDate);
  if (problem) throw new InvalidInputError(problem);
  const db = await getDb();
  await db.update(s.users).set({ birthDate }).where(eq(s.users.id, userId));
}

/** Takes the current password, so a session left open somewhere can't lock the owner out. */
export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const problem = passwordProblem(next);
  if (problem) throw new InvalidInputError(problem);
  const db = await getDb();
  const [u] = await db.select({ hash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, userId));
  if (!u) throw new NotFoundError("Account not found");
  if (!(await bcrypt.compare(current, u.hash))) throw new ForbiddenError("Your current password isn't right.");
  await db.update(s.users).set({ passwordHash: await bcrypt.hash(next, 12) }).where(eq(s.users.id, userId));
}

export async function renameUser(userId: string, name: string): Promise<void> {
  const db = await getDb();
  await db.update(s.users).set({ name: name.trim() }).where(eq(s.users.id, userId));
}

/** The email is the sign-in name, so changing it takes the current password. */
export async function changeEmail(userId: string, email: string, password: string): Promise<void> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const [u] = await db.select({ hash: s.users.passwordHash, email: s.users.email }).from(s.users).where(eq(s.users.id, userId));
  if (!u) throw new NotFoundError("Account not found");
  if (!(await bcrypt.compare(password, u.hash))) throw new ForbiddenError("That password isn't right.");
  if (normalized === u.email) return;
  const [taken] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, normalized));
  if (taken) throw new ConflictError("An account with that email already exists.");
  await db.update(s.users).set({ email: normalized }).where(eq(s.users.id, userId));
}

export async function saveSettings(userId: string, settings: UserSettings): Promise<UserSettings> {
  const db = await getDb();
  const clean = parseSettings(settings);
  await db.update(s.users).set({ settings: clean }).where(eq(s.users.id, userId));
  return clean;
}

/** Sets the profile photo from a data: URL (JPEG, PNG, or WebP), or removes it with null. Returns its new URL. */
export async function setAvatar(userId: string, dataUrl: string | null): Promise<string | null> {
  const db = await getDb();
  if (dataUrl === null) {
    await db.update(s.users).set({ avatar: null, avatarUpdatedAt: null }).where(eq(s.users.id, userId));
    return null;
  }
  const m = AVATAR_DATA_URL.exec(dataUrl);
  if (!m) throw new InvalidInputError("Upload a JPEG, PNG, or WebP image.");
  if (Buffer.byteLength(m[2], "base64") > MAX_AVATAR_BYTES) throw new InvalidInputError("That image is too large.");
  const now = new Date();
  await db.update(s.users).set({ avatar: dataUrl, avatarUpdatedAt: now }).where(eq(s.users.id, userId));
  return avatarUrl(userId, now);
}

/** A profile photo's bytes, for serving. */
export async function getAvatar(userId: string): Promise<{ type: string; bytes: Buffer } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const db = await getDb();
  const [u] = await db.select({ avatar: s.users.avatar }).from(s.users).where(eq(s.users.id, userId));
  const m = u?.avatar ? AVATAR_DATA_URL.exec(u.avatar) : null;
  return m ? { type: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}

// ---------- Trips ----------

/**
 * Loads a trip and the user's role on it: owner if they created it, or the
 * role it was shared with them at. Anyone else gets NotFound, so trip ids
 * don't leak.
 */
export async function tripAccess(userId: string, tripId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw new NotFoundError("Trip not found");
  const db = await getDb();
  const [row] = await db
    .select({ trip: s.trips, memberRole: s.tripMembers.role })
    .from(s.trips)
    .leftJoin(s.tripMembers, and(eq(s.tripMembers.tripId, s.trips.id), eq(s.tripMembers.userId, userId)))
    .where(eq(s.trips.id, tripId));
  const role: Role | null = row?.trip.createdBy === userId ? "owner" : (row?.memberRole ?? null);
  if (!row || !role) throw new NotFoundError("Trip not found");
  return { db, trip: row.trip, role };
}

/** tripAccess for changing who a trip is shared with. */
async function manageAccess(userId: string, tripId: string) {
  const access = await tripAccess(userId, tripId);
  if (access.role !== "owner") throw new ForbiddenError("Only the trip's owner can share it.");
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

/**
 * The trip this user's agent turn is running on, if any. Each person runs one
 * turn at a time, across all their trips, so requests don't pile up.
 */
async function runningTurn(db: Pick<Db, "select">, userId: string): Promise<{ id: string; title: string } | null> {
  const [row] = await db
    .select({ id: s.trips.id, title: s.trips.title })
    .from(s.trips)
    .where(and(eq(s.trips.turnUserId, userId), gt(s.trips.turnStartedAt, new Date(Date.now() - TURN_LOCK_MS))));
  return row ?? null;
}

const stillPlanning = (title: string) =>
  `PlanAway is still working on “${title}”. You can start another request when it finishes.`;

/**
 * Deletes the account for good, after checking the password. Trips the user
 * owns go with it, for everyone they were shared with. On other people's
 * trips, their messages and comments stay, shown as from "Deleted user".
 */
export async function deleteAccount(userId: string, password: string): Promise<void> {
  const db = await getDb();
  const [u] = await db.select({ hash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, userId));
  if (!u) throw new NotFoundError("Account not found");
  if (!(await bcrypt.compare(password, u.hash))) throw new ForbiddenError("That password isn't right.");
  // Deleting a trip mid-turn would leave the agent writing to nothing.
  const busy = await runningTurn(db, userId);
  if (busy) throw new ConflictError(`PlanAway is still working on “${busy.title}”. Try again when it finishes.`);
  await db.delete(s.users).where(eq(s.users.id, userId));
}

/** Refuses while the user's agent is busy on another trip, so a new trip isn't left empty. */
export async function createTrip(userId: string): Promise<{ id: string }> {
  const db = await getDb();
  const busy = await runningTurn(db, userId);
  if (busy) throw new ConflictError(stillPlanning(busy.title));
  const [trip] = await db.insert(s.trips).values({ createdBy: userId }).returning({ id: s.trips.id });
  return trip;
}

/** The user's own trips and the ones shared with them, most recently updated first. */
export async function listTrips(userId: string): Promise<TripSummary[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: s.trips.id,
      title: s.trips.title,
      destinations: s.trips.destinations,
      updatedAt: s.trips.updatedAt,
      hasItinerary: sql<boolean>`${s.trips.itinerary} is not null`,
      startDate: sql<string | null>`${s.trips.itinerary}->>'start_date'`,
      completedAt: s.trips.completedAt,
      createdBy: s.trips.createdBy,
      memberRole: s.tripMembers.role,
      ownerName: s.users.name,
    })
    .from(s.trips)
    .innerJoin(s.users, eq(s.users.id, s.trips.createdBy))
    .leftJoin(s.tripMembers, and(eq(s.tripMembers.tripId, s.trips.id), eq(s.tripMembers.userId, userId)))
    .where(or(eq(s.trips.createdBy, userId), eq(s.tripMembers.userId, userId)))
    .orderBy(desc(s.trips.updatedAt));
  return rows.map(({ createdBy, memberRole, ownerName, ...t }) => {
    const mine = createdBy === userId;
    return {
      ...t,
      updatedAt: t.updatedAt.toISOString(),
      startDate: t.startDate || null,
      completedAt: t.completedAt?.toISOString() ?? null,
      role: mine ? "owner" : (memberRole ?? "viewer"),
      sharedBy: mine ? null : ownerName,
    };
  });
}

export async function getTripView(userId: string, tripId: string): Promise<TripView> {
  const { db, trip, role } = await tripAccess(userId, tripId);
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
    role !== "owner"
      ? db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.id, trip.createdBy))
      : Promise.resolve([]),
  ]);
  return {
    id: trip.id,
    title: trip.title,
    role,
    sharedBy: role === "owner" ? null : (creator[0] ?? null),
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
export async function getTripRevision(userId: string, tripId: string): Promise<{ revision: number; busy: UserRef | null; viewers: Viewer[] }> {
  const { db, trip } = await tripAccess(userId, tripId);
  const person = { id: s.users.id, name: s.users.name, avatarUpdatedAt: s.users.avatarUpdatedAt };
  const toViewer = ({ avatarUpdatedAt, ...u }: { id: string; name: string; avatarUpdatedAt: Date | null }): Viewer => ({
    ...u,
    avatarUrl: avatarUrl(u.id, avatarUpdatedAt),
  });
  let busy: Viewer | null = null;
  if (lockIsLive(trip.turnStartedAt) && trip.turnUserId) {
    const [row] = await db.select(person).from(s.users).where(eq(s.users.id, trip.turnUserId));
    busy = row ? toViewer(row) : null;
  }
  // Polling doubles as a heartbeat: record this user, then list who else is here.
  await db
    .insert(s.tripPresence)
    .values({ tripId, userId, seenAt: new Date() })
    .onConflictDoUpdate({ target: [s.tripPresence.tripId, s.tripPresence.userId], set: { seenAt: new Date() } });
  const viewers = (
    await db
      .select(person)
      .from(s.tripPresence)
      .innerJoin(s.users, eq(s.users.id, s.tripPresence.userId))
      .where(and(eq(s.tripPresence.tripId, tripId), gt(s.tripPresence.seenAt, new Date(Date.now() - PRESENCE_MS))))
      .orderBy(asc(s.users.name))
  ).map(toViewer);
  // A tab streaming its own turn stops polling, but its user is still here.
  if (busy && !viewers.some((v) => v.id === busy.id)) viewers.push(busy);
  const busyRef = busy && { id: busy.id, name: busy.name };
  return { revision: trip.revision, busy: busyRef, viewers: viewers.filter((v) => v.id !== userId) };
}

export async function renameTrip(userId: string, tripId: string, title: string): Promise<void> {
  const { db, role } = await tripAccess(userId, tripId);
  requireRole(role, "editor", "rename trips");
  await db.update(s.trips).set({ title }).where(eq(s.trips.id, tripId));
  await bump(db, tripId);
}

/** Moves a trip to (or out of) Completed for everyone who has it. It isn't an edit to the
 *  plan, so the trip keeps its place in "recently updated"; the revision still moves so
 *  collaborators' lists catch up. */
export async function setTripCompleted(userId: string, tripId: string, completed: boolean): Promise<void> {
  const { db, role } = await tripAccess(userId, tripId);
  requireRole(role, "editor", "mark trips completed");
  await db
    .update(s.trips)
    .set({ completedAt: completed ? new Date() : null, revision: sql`${s.trips.revision} + 1` })
    .where(eq(s.trips.id, tripId));
}

/** Only the trip's owner can delete it. */
export async function deleteTrip(userId: string, tripId: string): Promise<void> {
  const { db, trip, role } = await tripAccess(userId, tripId);
  if (role !== "owner") throw new ForbiddenError("Only the trip's owner can delete it.");
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

/** The owner can remove anyone; anyone can remove themselves (leave). */
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
 * Gives the user access to the invite's trip. The owner opening their own
 * link is left as they are; people who were shared it before keep the higher
 * of their old role and the invite's.
 */
export async function acceptTripInvite(userId: string, token: string): Promise<{ tripId: string }> {
  const db = await getDb();
  const { invite, trip } = await liveTripInvite(db, token);
  if (trip.createdBy !== userId) {
    const insert = db.insert(s.tripMembers).values({ tripId: trip.id, userId, role: invite.role });
    // An editor link upgrades a viewer; a viewer link never downgrades an editor.
    await (invite.role === "editor"
      ? insert.onConflictDoUpdate({ target: [s.tripMembers.tripId, s.tripMembers.userId], set: { role: "editor" } })
      : insert.onConflictDoNothing());
  }
  return { tripId: trip.id };
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
  return db.transaction(async (tx) => {
    // Serializes this user's claims, so two sent at once can't both pass the
    // one-turn-per-person check below. Released when the transaction ends.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const busy = await runningTurn(tx, userId);
    if (busy && busy.id !== tripId) throw new ConflictError(stillPlanning(busy.title));
    const claimed = await tx
      .update(s.trips)
      .set({ turnStartedAt: new Date(), turnUserId: userId, revision: sql`${s.trips.revision} + 1` })
      .where(and(eq(s.trips.id, tripId), or(isNull(s.trips.turnStartedAt), lt(s.trips.turnStartedAt, staleBefore))))
      .returning({ id: s.trips.id });
    return claimed.length === 1;
  });
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
          byAgent: true,
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
    author: c.authorId ? { id: c.authorId, name: authorName ?? "Deleted user" } : null,
    byAgent: c.byAgent,
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

/** Authors can delete their own comments; the trip's owner can delete any. Deleting a thread's first comment deletes the thread. */
export async function deleteComment(userId: string, tripId: string, commentId: string): Promise<void> {
  const { db, role } = await tripAccess(userId, tripId);
  const c = await threadRoot(db, tripId, commentId);
  if (c.authorId !== userId) requireRole(role, "owner", "delete other people's comments");
  await db.delete(s.comments).where(eq(s.comments.id, commentId));
  await bump(db, tripId);
}
