import { handler, requireUser, type IdParams } from "@/lib/http";
import { getTripSharing } from "@/lib/store";

export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const user = await requireUser();
  return Response.json(await getTripSharing(user.id, (await params).id));
});
