import { body, handler, jsonError, requireUser, str } from "@/lib/http";
import { createTrip } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const groupId = str((await body(req)).groupId, 64);
  if (!groupId) return jsonError("groupId is required.", 400);
  return Response.json(await createTrip(user.id, groupId), { status: 201 });
});
