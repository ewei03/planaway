import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SettingsPage } from "@/components/SettingsPage";
import { getProfile, NotFoundError } from "@/lib/store";

export const metadata: Metadata = { title: "Settings · PlanAway" };

export default async function Settings() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/settings");
  const profile = await getProfile(session.user.id).catch((err) => {
    if (err instanceof NotFoundError) redirect("/login");
    throw err;
  });
  return <SettingsPage profile={profile} />;
}
