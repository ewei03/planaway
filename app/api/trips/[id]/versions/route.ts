import { body, handler, requireUser, str, type IdParams } from "@/lib/http";
import { saveVersion } from "@/lib/store";

export const POST = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const label = str((await body(req)).label, 120);
  return Response.json(await saveVersion(user.id, (await params).id, label), { status: 201 });
});
