import { COMMENT_TARGETS } from "@/lib/db/schema";
import { body, handler, jsonError, requireUser, str, type IdParams } from "@/lib/http";
import { addComment, type CommentTarget } from "@/lib/store";

/** Body: { body, parentId } to reply, or { body, targetType, targetId, targetLabel } to start a thread. */
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const tripId = (await params).id;
  const b = await body(req);
  const text = str(b.body, 4000);
  if (!text) return jsonError("Comment can't be empty.", 400);
  const parentId = str(b.parentId, 64);
  if (parentId) {
    await addComment(user.id, tripId, { parentId, body: text });
  } else {
    const targetType = b.targetType as CommentTarget;
    if (!COMMENT_TARGETS.includes(targetType)) return jsonError("Invalid comment target.", 400);
    const targetId = str(b.targetId, 64) || null;
    if (targetType !== "trip" && !targetId) return jsonError("targetId is required.", 400);
    const targetLabel = str(b.targetLabel, 200) || "Whole trip";
    await addComment(user.id, tripId, { targetType, targetId, targetLabel, body: text });
  }
  return new Response(null, { status: 201 });
});
