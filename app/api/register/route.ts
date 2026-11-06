import { birthDateProblem, passwordProblem } from "@/lib/account";
import { sendVerification } from "@/lib/accountEmails";
import { body, handler, jsonError, str } from "@/lib/http";
import { allow, clientIp } from "@/lib/rateLimit";
import { emailVerificationOn } from "@/lib/site";
import { createUser } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  // Each sign-up sends an email; don't let one address flood inboxes with them.
  if (!allow(`register:${clientIp(req)}`, 20, 60 * 60 * 1000)) return jsonError("Too many sign-ups from here. Try again later.", 429);
  const b = await body(req);
  const name = str(b.name, 80);
  const email = str(b.email, 200);
  const password = typeof b.password === "string" ? b.password : "";
  if (!name) return jsonError("Name is required.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.", 400);
  const passwordError = passwordProblem(password);
  if (passwordError) return jsonError(passwordError, 400);
  // Checked before anything is stored, so nothing is kept about an under-13.
  const birthDateError = birthDateProblem(b.birthDate);
  if (birthDateError) return jsonError(birthDateError, 400);
  const verify = emailVerificationOn();
  const user = await createUser(name, email, password, b.birthDate as string, { verified: !verify });
  // `verify`: the sign-up page asks for the emailed code before signing in.
  if (!verify) return Response.json({ ok: true, verify: false }, { status: 201 });
  // The account exists either way: if the email can't go now, "Send a new code" can retry.
  await sendVerification({ ...user, email: email.toLowerCase() }).catch((err) => console.error("Couldn't send the confirmation email:", err));
  return Response.json({ ok: true, verify: true }, { status: 201 });
});
