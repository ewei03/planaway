import { handler, requireUser } from "@/lib/http";
import { createTrip, listTrips } from "@/lib/store";

/** The signed-in user's trips and the ones shared with them. */
export const GET = handler(async () => {
  const user = await requireUser();
  return Response.json(await listTrips(user.id));
});

export const POST = handler(async () => {
  const user = await requireUser();
  return Response.json(await createTrip(user.id), { status: 201 });
});
