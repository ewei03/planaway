import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";

/** A single card in the middle of the page, for account steps: confirming an email, resetting a password. */
export function AccountCard({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card card account-card">{children}</div>
      <SiteFooter />
    </main>
  );
}
