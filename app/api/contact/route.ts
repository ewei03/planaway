import { contactMessage, sendEmail } from "@/lib/email";
import { body, handler, jsonError, str } from "@/lib/http";
import { allow, clientIp } from "@/lib/rateLimit";
import { CONTACT_TOPICS, contactEmail } from "@/lib/site";

/**
 * Body: { name, email, topic, message, website }. Emails the message to
 * CONTACT_EMAIL, with replies going to the sender. Open to everyone, signed
 * in or not. `website` is a field people never see: bots fill it in.
 */
export const POST = handler(async (req: Request) => {
  const to = contactEmail();
  if (!to) return jsonError("The contact form isn't set up yet.", 503);
  const b = await body(req);
  // Quietly accept what a bot sends, so it doesn't learn to skip the field.
  if (str(b.website, 200)) return Response.json({ ok: true });
  // One line each: these go into the email's headers.
  const name = str(b.name, 80).replace(/[\r\n]+/g, " ");
  const email = str(b.email, 200).replace(/[\r\n]+/g, "");
  const topic = CONTACT_TOPICS.includes(str(b.topic, 80)) ? str(b.topic, 80) : "Something else";
  const message = str(b.message, 5000);
  if (!name) return jsonError("Enter your name.", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Enter a valid email address, so we can reply.", 400);
  if (message.length < 10) return jsonError("Tell us a little more in your message.", 400);
  if (!allow(`contact:${clientIp(req)}`, 5, 60 * 60 * 1000)) return jsonError("You've sent several messages already. Try again later, or email us directly.", 429);
  try {
    await sendEmail(contactMessage(to, { name, email }, topic, message));
  } catch (err) {
    console.error("Couldn't send a contact message:", err);
    return jsonError(`We couldn't send your message just now. Please email us at ${to}.`, 502);
  }
  return Response.json({ ok: true });
});
