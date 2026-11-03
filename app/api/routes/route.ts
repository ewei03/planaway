import { body, handler, jsonError, requireUser } from "@/lib/http";
import type { LatLng } from "@/lib/route";
import { MAX_POINTS, MAX_SEQUENCES, resolveLegs } from "@/lib/routing";

const isCoord = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

/**
 * Body: { sequences: [lat, lng][][] }, the stops of each day in order. Returns
 * { legs: { [legKey]: Leg | null } } for cached legs and a few new routes;
 * legs missing from the result haven't been routed yet, so ask again.
 */
export const POST = handler(async (req: Request) => {
  await requireUser();
  const raw = (await body(req)).sequences;
  if (!Array.isArray(raw)) return jsonError("sequences must be an array of [lat, lng] lists.", 400);
  const sequences: LatLng[][] = [];
  for (const seq of raw.slice(0, MAX_SEQUENCES)) {
    if (!Array.isArray(seq)) return jsonError("sequences must be an array of [lat, lng] lists.", 400);
    const points: LatLng[] = [];
    for (const p of seq.slice(0, MAX_POINTS)) {
      if (!Array.isArray(p) || !isCoord(p[0], 90) || !isCoord(p[1], 540)) return jsonError("Each point must be [lat, lng].", 400);
      points.push({ lat: p[0], lng: p[1] });
    }
    sequences.push(points);
  }
  return Response.json({ legs: await resolveLegs(sequences) });
});
