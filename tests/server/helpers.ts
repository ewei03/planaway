import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema as s } from "@/lib/db";
import type { Itinerary } from "@/lib/itinerary";
import { acceptTripInvite, createTrip, createTripInvite, createUser, type InviteRole, type UserRef } from "@/lib/store";

let n = 0;

/** Creates a user with a unique email. */
export async function makeUser(name = "User"): Promise<UserRef & { email: string; password: string }> {
  const email = `${name.toLowerCase().replace(/\W/g, "")}-${++n}-${randomUUID().slice(0, 8)}@example.com`;
  const password = "correct horse battery";
  const user = await createUser(name, email, password);
  return { ...user, email, password };
}

/** Shares one trip with `user` through an invite link, as `sharer`. */
export async function shareTrip(sharer: UserRef, tripId: string, user: UserRef, role: InviteRole = "viewer") {
  const { token } = await createTripInvite(sharer.id, tripId, role, 7);
  await acceptTripInvite(user.id, token);
}

export async function makeTrip(userId: string, itinerary: Itinerary | null = null) {
  const { id } = await createTrip(userId);
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

/**
 * Ends every running agent turn. Tests share users, and each person may run
 * only one turn at a time, so a turn one test leaves open would block the next.
 */
export async function releaseAllTurns() {
  const db = await getDb();
  await db.update(s.trips).set({ turnStartedAt: null, turnUserId: null });
}
