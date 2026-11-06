import { redirect } from "next/navigation";

/**
 * Where confirmation links used to lead, before addresses were confirmed with
 * a code. Signing in now asks for a fresh code, so old links go there.
 */
export default function VerifyEmailPage() {
  redirect("/login");
}
