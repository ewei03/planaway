import { handler, requireUser } from "@/lib/http";
import { acceptInvite, getInvite } from "@/lib/store";

type Params = { params: Promise<{ token: string }> };

export const GET = handler(async (_req: Request, { params }: Params) => {
  await requireUser();
  return Response.json(await getInvite((await params).token));
});

export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUser();
  return Response.json(await acceptInvite(user.id, (await params).token));
});
