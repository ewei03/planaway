import type { Metadata } from "next";
import Link from "next/link";
import { AccountCard } from "@/components/AccountCard";
import { ResetPasswordForm } from "@/components/PasswordReset";

export const metadata: Metadata = { title: "Reset password · PlanAway" };

/** Where the link in a reset email leads. The token is checked when the new password is sent, so opening the link changes nothing. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <AccountCard>
      {typeof token === "string" && token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <h1>This link isn&rsquo;t complete</h1>
          <p className="muted">Open the link from your email again, or ask for a new one.</p>
          <Link className="btn primary block" href="/forgot-password">
            Send a new link
          </Link>
        </>
      )}
    </AccountCard>
  );
}
