import { body, handler, jsonError, str } from "@/lib/http";
import { allow, clientIp } from "@/lib/rateLimit";
import { verifyEmailCode } from "@/lib/store";

const ERRORS = {
  wrong: "That code isn't right. Check the latest email from PlanAway and try again.",
  expired: "This code has expired. Send yourself a new one.",
};

/** Body: { email, code }. Confirms the address with the code emailed to it. Each code allows a few wrong tries. */
export const POST = handler(async (req: Request) => {
  if (!allow(`verify-confirm:${clientIp(req)}`, 30, 15 * 60 * 1000)) return jsonError("Too many tries. Wait a few minutes and try again.", 429);
  const b = await body(req);
  const email = str(b.email, 200);
  const code = str(b.code, 20).replace(/\s/g, "");
  if (!email) return jsonError("Email is required.", 400);
  if (!/^\d{6}$/.test(code)) return jsonError("Enter the 6-digit code from the email.", 400);
  const result = await verifyEmailCode(email, code);
  if (result === "wrong" || result === "expired") return jsonError(ERRORS[result], 400);
  return Response.json({ verified: true });
});
