import { body, handler, str } from "@/lib/http";
import { resetPassword } from "@/lib/store";

/** Body: { token, password }. Sets the new password from a reset link; the link then stops working. */
export const POST = handler(async (req: Request) => {
  const b = await body(req);
  await resetPassword(str(b.token, 200), typeof b.password === "string" ? b.password : "");
  return Response.json({ ok: true });
});
