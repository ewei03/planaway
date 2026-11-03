import { body, handler, jsonError, requireUser } from "@/lib/http";
import { setAvatar } from "@/lib/store";

/** Body: { dataUrl }, a JPEG, PNG, or WebP data: URL the browser has already shrunk. */
export const PUT = handler(async (req: Request) => {
  const user = await requireUser();
  const dataUrl = (await body(req)).dataUrl;
  if (typeof dataUrl !== "string") return jsonError("dataUrl is required.", 400);
  return Response.json({ avatarUrl: await setAvatar(user.id, dataUrl) });
});

export const DELETE = handler(async () => {
  const user = await requireUser();
  await setAvatar(user.id, null);
  return new Response(null, { status: 204 });
});
