import type { Metadata } from "next";
import { AccountCard } from "@/components/AccountCard";
import { ForgotPasswordContact, ForgotPasswordForm } from "@/components/PasswordReset";
import { contactEmail, emailSendingOn, operatorName } from "@/lib/site";

export const metadata: Metadata = { title: "Forgot password · PlanAway" };
// Whether reset emails can go out is read from the environment when the page is served.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AccountCard>
      {emailSendingOn() ? <ForgotPasswordForm /> : <ForgotPasswordContact contactEmail={contactEmail()} operator={operatorName()} />}
    </AccountCard>
  );
}
