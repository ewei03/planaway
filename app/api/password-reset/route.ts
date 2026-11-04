import { sendPasswordReset } from "@/lib/accountEmails";
import { body, handler, jsonError, str } from "@/lib/http";
import { allow, clientIp } from "@/lib/rateLimit";
import { findUserByEmail } from "@/lib/store";

/**
 * Body: { email }. Emails a reset link if there's an account with that
 * address. The answer is the same either way, so this can't be used to find
 * out who has an account.
 */
export const POST = handler(async (req: Request) => {
  if (!allow(`reset-ip:${clientIp(req)}`, 10, 15 * 60 * 1000)) return jsonError("Too many requests. Try again in a few minutes.", 429);
  const email = str((await body(req)).email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.", 400);
  const user = await findUserByEmail(email);
  // A few per address, quietly: refusing out loud would tell that the account exists.
  if (user && allow(`reset:${email}`, 3, 15 * 60 * 1000)) {
    await sendPasswordReset(req, user).catch((err) => console.error("Couldn't send the password reset email:", err));
  }
  return Response.json({ ok: true });
});
