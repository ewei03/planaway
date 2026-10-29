import { handler, requireUser } from "@/lib/http";
import { listSharedTrips } from "@/lib/store";

/** Trips shared with the signed-in user through invite links. */
export const GET = handler(async () => {
  const user = await requireUser();
  return Response.json(await listSharedTrips(user.id));
});
