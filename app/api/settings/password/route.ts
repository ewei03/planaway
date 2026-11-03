import { body, handler, requireUser } from "@/lib/http";
import { changePassword } from "@/lib/store";

/** Body: { current, next }. */
export const PUT = handler(async (req: Request) => {
  const user = await requireUser();
  const b = await body(req);
  await changePassword(user.id, typeof b.current === "string" ? b.current : "", typeof b.next === "string" ? b.next : "");
  return new Response(null, { status: 204 });
});
