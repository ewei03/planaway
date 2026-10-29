import { handler, requireUser } from "@/lib/http";
import { acceptTripInvite, getInvitePreview } from "@/lib/store";

type Params = { params: Promise<{ token: string }> };

/** The trip preview. No sign-in needed: the link itself is the permission. */
export const GET = handler(async (_req: Request, { params }: Params) => {
  return Response.json(await getInvitePreview((await params).token));
});

/** Joins the trip. Signing in is required. */
export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  return Response.json(await acceptTripInvite(user.id, (await params).token));
});
