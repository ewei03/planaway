import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema as s } from "@/lib/db";
import type { Itinerary } from "@/lib/itinerary";
import { acceptTripInvite, createGroup, createTrip, createTripInvite, createUser, type InviteRole, type Role, type UserRef } from "@/lib/store";

let n = 0;

/** Creates a user with a unique email. */
export async function makeUser(name = "User"): Promise<UserRef & { email: string; password: string }> {
  const email = `${name.toLowerCase().replace(/\W/g, "")}-${++n}-${randomUUID().slice(0, 8)}@example.com`;
  const password = "correct horse battery";
  const user = await createUser(name, email, password);
  return { ...user, email, password };
}

/** The id of the user's personal group. */
export async function personalGroupId(userId: string): Promise<string> {
  const db = await getDb();
  const [g] = await db.select({ id: s.groups.id }).from(s.groups).where(eq(s.groups.createdBy, userId));
  return g.id;
}

/** A shared group owned by `owner`, with the other users joined at the given roles. */
export async function makeGroup(owner: UserRef, members: [UserRef, Exclude<Role, "owner">][] = [], name = "Crew") {
  const { id } = await createGroup(owner.id, name);
  // There are no group invite links; members are added directly.
  const db = await getDb();
  for (const [user, role] of members) await db.insert(s.groupMembers).values({ groupId: id, userId: user.id, role });
  return id;
}

/** Shares one trip with `user` through an invite link, as `sharer`. */
export async function shareTrip(sharer: UserRef, tripId: string, user: UserRef, role: InviteRole = "viewer") {
  const { token } = await createTripInvite(sharer.id, tripId, role, 7);
  await acceptTripInvite(user.id, token);
}

export async function makeTrip(userId: string, groupId: string, itinerary: Itinerary | null = null) {
  const { id } = await createTrip(userId, groupId);
  if (itinerary) await setTrip(id, { itinerary });
  return id;
}

/** Writes trip columns directly, for setting up states the API can't reach quickly. */
export async function setTrip(tripId: string, values: Partial<typeof s.trips.$inferInsert>) {
  const db = await getDb();
  await db.update(s.trips).set(values).where(eq(s.trips.id, tripId));
}

export async function getTripRow(tripId: string) {
  const db = await getDb();
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, tripId));
  return trip;
}
