import { body, handler, jsonError, requireUser } from "@/lib/http";
import { removeTripMember, setTripMemberRole } from "@/lib/store";

type Params = { params: Promise<{ id: string; userId: string }> };

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const role = (await body(req)).role;
  if (role !== "editor" && role !== "viewer") return jsonError('Role must be "editor" or "viewer".', 400);
  const { id, userId } = await params;
  await setTripMemberRole(user.id, id, userId, role);
  return new Response(null, { status: 204 });
});

/** Removes someone the trip was shared with, or leaves it when userId is your own. */
export const DELETE = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { id, userId } = await params;
  await removeTripMember(user.id, id, userId);
  return new Response(null, { status: 204 });
});
