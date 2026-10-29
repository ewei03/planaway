import { body, handler, jsonError, requireUser, type IdParams } from "@/lib/http";
import { createTripInvite, INVITE_EXPIRY_DAYS, type InviteExpiry } from "@/lib/store";

export const POST = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const { role, expiresInDays = 7 } = await body(req);
  if (role !== "editor" && role !== "viewer") return jsonError('Role must be "editor" or "viewer".', 400);
  if (!INVITE_EXPIRY_DAYS.includes(expiresInDays as InviteExpiry)) {
    return jsonError("expiresInDays must be 1, 7, 30, or null.", 400);
  }
  return Response.json(await createTripInvite(user.id, (await params).id, role, expiresInDays as InviteExpiry), { status: 201 });
});
