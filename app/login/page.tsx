import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/AuthForm";
import { getProfile, NotFoundError } from "@/lib/store";

/** Only same-site paths, so the redirect after sign-in can't be pointed elsewhere. */
function safeCallback(url: string | string[] | undefined): string {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[]; deleted?: string | string[] }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallback(params.callbackUrl);
  const userId = (await auth())?.user?.id;
  // A session can outlive its account (deleted on another device). Show the
  // form then, rather than bouncing between here and the home page.
  if (userId && (await accountExists(userId))) redirect(callbackUrl);
  return <AuthForm callbackUrl={callbackUrl} notice={params.deleted === "1" ? "Your account has been deleted." : undefined} />;
}

async function accountExists(userId: string): Promise<boolean> {
  return getProfile(userId).then(
    () => true,
    (err) => {
      if (err instanceof NotFoundError) return false;
      throw err;
    },
  );
}
