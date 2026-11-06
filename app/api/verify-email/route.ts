import { sendVerification } from "@/lib/accountEmails";
import { body, handler, jsonError, str } from "@/lib/http";
import { allow, clientIp } from "@/lib/rateLimit";
import { findUnverifiedUser } from "@/lib/store";

/**
 * Body: { email }. Sends a new confirmation code, if an account with that
 * address is waiting to be confirmed. Signed in or not: the sign-in page asks
 * for a code before letting an unconfirmed account in. Answers the same
 * whether or not there's such an account, so it doesn't tell which exist.
 */
export const POST = handler(async (req: Request) => {
  const email = str((await body(req)).email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.", 400);
  // Counted per address whether or not it has an account, so the limit gives nothing away either.
  if (!allow(`verify-send:${clientIp(req)}`, 10, 60 * 60 * 1000) || !allow(`verify-send:${email}`, 3, 15 * 60 * 1000)) {
    return jsonError("We've sent a few codes already. Check your inbox and spam folder, or try again in a few minutes.", 429);
  }
  const user = await findUnverifiedUser(email);
  if (user) {
    try {
      await sendVerification(user);
    } catch (err) {
      console.error("Couldn't send the confirmation email:", err);
      return jsonError("We couldn't send the email just now. Try again in a few minutes.", 502);
    }
  }
  return Response.json({ sent: true });
});
