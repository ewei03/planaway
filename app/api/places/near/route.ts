import { handler, jsonError, requireUser } from "@/lib/http";
import { findNear } from "@/lib/placeSearch";

/** ?q=an activity's name&lat=&lng= near where it should be. Returns { place: Place | null }: the closest good match. */
export const GET = handler(async (req: Request) => {
  await requireUser();
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!q) return jsonError("q is required.", 400);
  if (!params.get("lat") || !params.get("lng") || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return jsonError("lat and lng must be coordinates.", 400);
  try {
    return Response.json({ place: await findNear(q, { lat, lng }) });
  } catch (err) {
    console.error(`Nearby search failed for "${q}":`, (err as Error).message);
    return jsonError("The place search isn't answering. Try again in a moment.", 502);
  }
});
