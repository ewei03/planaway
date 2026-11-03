import { body, handler, jsonError, requireUser, str } from "@/lib/http";
import { changeEmail, getProfile, renameUser } from "@/lib/store";

/** The signed-in user's profile and settings. */
export const GET = handler(async () => {
  const user = await requireUser();
  return Response.json(await getProfile(user.id));
});

/** Body: { name } and/or { email, password }. Changing the email takes the current password. */
export const PATCH = handler(async (req: Request) => {
  const user = await requireUser();
  const b = await body(req);
  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (!name) return jsonError("Name is required.", 400);
    await renameUser(user.id, name);
  }
  if (b.email !== undefined) {
    const email = str(b.email, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.", 400);
    const password = typeof b.password === "string" ? b.password : "";
    if (!password) return jsonError("Enter your current password to change your email.", 400);
    await changeEmail(user.id, email, password);
  }
  return Response.json(await getProfile(user.id));
});
