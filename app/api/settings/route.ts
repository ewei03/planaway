import { body, handler, jsonError, requireUser, str } from "@/lib/http";
import { changeEmail, deleteAccount, getProfile, renameUser, setBirthDate } from "@/lib/store";

/** The signed-in user's profile and settings. */
export const GET = handler(async () => {
  const user = await requireUser();
  return Response.json(await getProfile(user.id));
});

/** Body: any of { name }, { birthDate }, and { email, password }. Changing the email takes the current password. */
export const PATCH = handler(async (req: Request) => {
  const user = await requireUser();
  const b = await body(req);
  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (!name) return jsonError("Name is required.", 400);
    await renameUser(user.id, name);
  }
  if (b.birthDate !== undefined) await setBirthDate(user.id, typeof b.birthDate === "string" ? b.birthDate : "");
  if (b.email !== undefined) {
    const email = str(b.email, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address.", 400);
    const password = typeof b.password === "string" ? b.password : "";
    if (!password) return jsonError("Enter your current password to change your email.", 400);
    await changeEmail(user.id, email, password);
  }
  return Response.json(await getProfile(user.id));
});

/** Body: { password }. Deletes the account and everything the user owns. */
export const DELETE = handler(async (req: Request) => {
  const user = await requireUser();
  const password = (await body(req)).password;
  if (typeof password !== "string" || !password) return jsonError("Enter your password to delete your account.", 400);
  await deleteAccount(user.id, password);
  return new Response(null, { status: 204 });
});
