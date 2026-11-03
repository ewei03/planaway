import { handler, requireUser } from "@/lib/http";
import { suggestPlaces } from "@/lib/placeSearch";

/** ?q=partial text. Returns { suggestions: PlaceSuggestion[] }: airports, cities, and addresses. */
export const GET = handler(async (req: Request) => {
  await requireUser();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  return Response.json({ suggestions: await suggestPlaces(q) });
});
