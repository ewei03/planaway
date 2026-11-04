import type { Metadata } from "next";
import Link from "next/link";
import { AccountCard } from "@/components/AccountCard";
import { verifyEmail } from "@/lib/store";

export const metadata: Metadata = { title: "Confirm email · PlanAway" };

const RESULTS = {
  verified: { title: "Email confirmed", text: "Thanks for confirming. You're all set to plan trips.", action: "Start planning" },
  already: { title: "Already confirmed", text: "This email address is confirmed. You're all set.", action: "Go to PlanAway" },
  invalid: {
    title: "This link has expired",
    text: "Confirmation links work for 24 hours, and only the newest one works. Sign in to PlanAway and send yourself a new one.",
    action: "Go to PlanAway",
  },
};

/** Where the link in a confirmation email leads. Confirms the address on arrival. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const result = RESULTS[await verifyEmail(typeof token === "string" ? token : "")];
  return (
    <AccountCard>
      <h1>{result.title}</h1>
      <p className="muted">{result.text}</p>
      <Link className="btn primary block" href="/">
        {result.action}
      </Link>
    </AccountCard>
  );
}
