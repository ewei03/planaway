import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/AuthForm";

/** Only same-site paths, so the redirect after sign-in can't be pointed elsewhere. */
function safeCallback(url: string | string[] | undefined): string {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const callbackUrl = safeCallback((await searchParams).callbackUrl);
  if ((await auth())?.user) redirect(callbackUrl);
  return <AuthForm callbackUrl={callbackUrl} />;
}
