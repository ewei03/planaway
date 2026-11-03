import { birthDateProblem, passwordProblem } from "@/lib/account";
import { body, handler, jsonError, str } from "@/lib/http";
import { createUser } from "@/lib/store";

export const POST = handler(async (req: Request) => {
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
  await createUser(name, email, password, b.birthDate as string);
  return Response.json({ ok: true }, { status: 201 });
});
