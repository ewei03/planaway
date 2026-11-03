import { handler, jsonError, requireUser, type IdParams } from "@/lib/http";
import { getAvatar } from "@/lib/store";

/**
 * A user's profile photo, for anyone signed in. Its URL carries a version that
 * changes with the photo, so it can be cached for good.
 */
export const GET = handler(async (_req: Request, { params }: IdParams) => {
  await requireUser();
  const avatar = await getAvatar((await params).id);
  if (!avatar) return jsonError("No photo", 404);
  return new Response(new Uint8Array(avatar.bytes), {
    headers: { "Content-Type": avatar.type, "Cache-Control": "private, max-age=31536000, immutable" },
  });
});
