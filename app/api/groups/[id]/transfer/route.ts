import { body, handler, jsonError, requireUser, str, type IdParams } from "@/lib/http";
import { transferOwnership } from "@/lib/store";

/** Hands the group to another member; the caller becomes an editor. */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const userId = str((await body(req)).userId, 64);
  if (!userId) return jsonError("userId is required.", 400);
  await transferOwnership(user.id, (await params).id, userId);
  return new Response(null, { status: 204 });
});
