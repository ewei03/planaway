import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PlanAway } from "@/components/PlanAway";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id, name, email } = session.user;
  return <PlanAway user={{ id, name: name ?? "Traveler", email: email ?? "" }} />;
}
