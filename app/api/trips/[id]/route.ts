import { body, handler, jsonError, requireUser, str, type IdParams } from "@/lib/http";
import { deleteTrip, getTripView, renameTrip } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const user = await requireUser();
  return Response.json(await getTripView(user.id, (await params).id));
});

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const title = str((await body(req)).title, 120);
  if (!title) return jsonError("Title is required.", 400);
  await renameTrip(user.id, (await params).id, title);
  return new Response(null, { status: 204 });
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  const user = await requireUser();
  await deleteTrip(user.id, (await params).id);
  return new Response(null, { status: 204 });
});
