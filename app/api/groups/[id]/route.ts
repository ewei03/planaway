import { body, handler, jsonError, requireUser, str, type IdParams } from "@/lib/http";
import { deleteGroup, getGroup, renameGroup } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const user = await requireUser();
  return Response.json(await getGroup(user.id, (await params).id));
});

export const PATCH = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const name = str((await body(req)).name, 80);
  if (!name) return jsonError("Group name is required.", 400);
  await renameGroup(user.id, (await params).id, name);
  return new Response(null, { status: 204 });
});

export const DELETE = handler(async (_req: Request, { params }: IdParams) => {
  const user = await requireUser();
  await deleteGroup(user.id, (await params).id);
  return new Response(null, { status: 204 });
});
