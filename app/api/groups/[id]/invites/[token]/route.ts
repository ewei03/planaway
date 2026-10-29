import { handler, requireUser } from "@/lib/http";
import { revokeInvite } from "@/lib/store";

export const DELETE = handler(async (_req: Request, { params }: { params: Promise<{ id: string; token: string }> }) => {
  const user = await requireUser();
  const { id, token } = await params;
  await revokeInvite(user.id, id, token);
  return new Response(null, { status: 204 });
});
