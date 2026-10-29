import { body, handler, jsonError, requireUser } from "@/lib/http";
import { removeMember, setMemberRole } from "@/lib/store";

type Params = { params: Promise<{ id: string; userId: string }> };

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const role = (await body(req)).role;
  if (role !== "owner" && role !== "editor" && role !== "viewer") return jsonError("Invalid role.", 400);
  const { id, userId } = await params;
  await setMemberRole(user.id, id, userId, role);
  return new Response(null, { status: 204 });
});

/** Removes a member, or leaves the group when userId is your own. */
export const DELETE = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { id, userId } = await params;
  await removeMember(user.id, id, userId);
  return new Response(null, { status: 204 });
});
