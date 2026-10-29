import { body, handler, jsonError, requireUser } from "@/lib/http";
import { deleteComment, setThreadResolved } from "@/lib/store";

type Params = { params: Promise<{ id: string; commentId: string }> };

/** Body: { resolved: boolean }. Applies to a thread's first comment. */
export const PATCH = handler(async (req: Request, { params }: Params) => {
  const user = await requireUser();
  const resolved = (await body(req)).resolved;
  if (typeof resolved !== "boolean") return jsonError("resolved must be true or false.", 400);
  const { id, commentId } = await params;
  await setThreadResolved(user.id, id, commentId, resolved);
  return new Response(null, { status: 204 });
});

export const DELETE = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  const { id, commentId } = await params;
  await deleteComment(user.id, id, commentId);
  return new Response(null, { status: 204 });
});
