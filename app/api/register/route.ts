import { body, handler, jsonError, str } from "@/lib/http";
import { createUser } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const b = await body(req);
  const name = str(b.name, 80);
  const email = str(b.email, 200);
  const password = typeof b.password === "string" ? b.password : "";
  if (!name) return jsonError("Name is required.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.", 400);
  if (password.length < 8) return jsonError("Password must be at least 8 characters.", 400);
  // bcrypt only uses the first 72 bytes.
  if (Buffer.byteLength(password) > 72) return jsonError("Password is too long (72 bytes max).", 400);
  await createUser(name, email, password);
  return Response.json({ ok: true }, { status: 201 });
});
