import { body, handler, jsonError, requireUser, type IdParams } from "@/lib/http";
import { createInvite } from "@/lib/store";

export const POST = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const role = (await body(req)).role;
  if (role !== "editor" && role !== "viewer") return jsonError('Role must be "editor" or "viewer".', 400);
  return Response.json(await createInvite(user.id, (await params).id, role), { status: 201 });
});
