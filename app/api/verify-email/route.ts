import { sendVerification } from "@/lib/accountEmails";
import { handler, jsonError, requireUser } from "@/lib/http";
import { allow } from "@/lib/rateLimit";
import { getProfile } from "@/lib/store";

/** Sends the signed-in user a new link to confirm their email address. Returns { verified } when there's nothing to confirm. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (profile.emailVerified) return Response.json({ verified: true });
  if (!allow(`verify:${user.id}`, 3, 15 * 60 * 1000)) return jsonError("We've sent a few already. Check your inbox and spam folder, or try again in a few minutes.", 429);
  try {
    await sendVerification(req, profile);
  } catch (err) {
    console.error("Couldn't send the confirmation email:", err);
    return jsonError("We couldn't send the email just now. Try again in a few minutes.", 502);
  }
  return Response.json({ sent: true });
});
