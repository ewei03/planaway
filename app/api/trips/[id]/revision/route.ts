import { handler, requireUser, type IdParams } from "@/lib/http";
import { getTripRevision } from "@/lib/store";

/** Polled by open tabs to notice collaborators' changes. */
export const GET = handler(async (_req: Request, { params }: IdParams) => {
  const user = await requireUser();
  return Response.json(await getTripRevision(user.id, (await params).id));
});
