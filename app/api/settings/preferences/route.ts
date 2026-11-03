import { body, handler, jsonError, requireUser } from "@/lib/http";
import { UserSettings } from "@/lib/settings";
import { saveSettings } from "@/lib/store";

/** Body: the full settings object (theme, activityColors, defaults). */
export const PUT = handler(async (req: Request) => {
  const user = await requireUser();
  // Strict here, unlike parseSettings: a bad value is reported, not quietly reset.
  const parsed = UserSettings.safeParse(await body(req));
  if (!parsed.success) return jsonError("Some settings aren't valid. Check the values and try again.", 400);
  return Response.json(await saveSettings(user.id, parsed.data));
});
