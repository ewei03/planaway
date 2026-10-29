import { body, handler, jsonError, requireUser, str } from "@/lib/http";
import { createGroup, listGroups } from "@/lib/store";

export const GET = handler(async () => {
  const user = await requireUser();
  return Response.json(await listGroups(user.id));
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const name = str((await body(req)).name, 80);
  if (!name) return jsonError("Group name is required.", 400);
  return Response.json(await createGroup(user.id, name), { status: 201 });
});
