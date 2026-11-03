import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PlanAway } from "@/components/PlanAway";
import { getProfile, NotFoundError } from "@/lib/store";

/** OpenFreeMap's free vector map style; no key needed. */
const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Home({ searchParams }: { searchParams: Promise<{ trip?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // From the database rather than the session, so changes made in settings show up.
  const profile = await getProfile(session.user.id).catch((err) => {
    if (err instanceof NotFoundError) redirect("/login");
    throw err;
  });
  const { settings, ...user } = profile;
  const maps = { styleUrl: process.env.MAP_STYLE_URL || DEFAULT_MAP_STYLE };
  const { trip } = await searchParams;
  // Only a well-formed id: anything else would just show a skeleton until the fetch fails.
  const initialTripId = typeof trip === "string" && UUID.test(trip) ? trip : null;
  return <PlanAway user={user} settings={settings} maps={maps} initialTripId={initialTripId} />;
}
