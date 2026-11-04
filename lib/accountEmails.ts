import { emailChangedMessage, resetPasswordMessage, sendEmail, verifyEmailMessage } from "./email";
import { appUrl } from "./site";
import { createEmailToken } from "./store";

// The account emails, with their one-time links. Sending can fail (the email
// provider is down, say); callers decide whether that matters.

export async function sendVerification(req: Request, user: { id: string; name: string; email: string }): Promise<void> {
  const token = await createEmailToken(user.id, "verify", user.email);
  await sendEmail(verifyEmailMessage(user.email, user.name, `${appUrl(req)}/verify-email?token=${token}`));
}

export async function sendPasswordReset(req: Request, user: { id: string; name: string; email: string }): Promise<void> {
  const token = await createEmailToken(user.id, "reset", user.email);
  await sendEmail(resetPasswordMessage(user.email, user.name, `${appUrl(req)}/reset-password?token=${token}`));
}

export async function sendEmailChanged(to: string, name: string, newEmail: string): Promise<void> {
  await sendEmail(emailChangedMessage(to, name, newEmail));
}
