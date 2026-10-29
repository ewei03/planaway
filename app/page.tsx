import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PlanAway } from "@/components/PlanAway";

/** OpenFreeMap's free vector map style; no key needed. */
const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id, name, email } = session.user;
  const maps = { styleUrl: process.env.MAP_STYLE_URL || DEFAULT_MAP_STYLE };
  return <PlanAway user={{ id, name: name ?? "Traveler", email: email ?? "" }} maps={maps} />;
}
