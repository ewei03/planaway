import type { Metadata } from "next";
import { AccountCard } from "@/components/AccountCard";
import { ForgotPasswordForm } from "@/components/PasswordReset";

export const metadata: Metadata = { title: "Forgot password · PlanAway" };

export default function ForgotPasswordPage() {
  return (
    <AccountCard>
      <ForgotPasswordForm />
    </AccountCard>
  );
}
