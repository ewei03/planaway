import { body, handler, jsonError, requireUser, str } from "@/lib/http";
import { MAX_QUERIES, resolvePlaces } from "@/lib/places";

/**
 * Body: { queries: string[] }. Returns { places: { [normalized query]: Place | null } }
 * for cached places and a few new lookups; queries missing from the result
 * haven't been looked up yet, so ask again.
 */
export const POST = handler(async (req: Request) => {
  await requireUser();
  const raw = (await body(req)).queries;
  if (!Array.isArray(raw)) return jsonError("queries must be an array of strings.", 400);
  const queries = raw.map((q) => str(q, 200)).filter(Boolean).slice(0, MAX_QUERIES);
  return Response.json({ places: await resolvePlaces(queries) });
});
