"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "./client";
import { MenuIcon } from "./icons";

/** "Send it again" for the confirmation email, with what happened. */
export function useResendVerification() {
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api<{ sent?: boolean; verified?: boolean }>("/api/verify-email", { method: "POST" });
      if (res.verified) window.location.reload();
      else setStatus({ kind: "ok", text: "Sent. Check your inbox, and your spam folder just in case." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { resend, status, busy };
}

/**
 * In place of the start screen until the user confirms their email address.
 * Coming back to the tab after clicking the link checks again, so the app
 * opens up without a manual reload.
 */
export function VerifyEmailPrompt({ email, onOpenSidebar }: { email: string; onOpenSidebar: () => void }) {
  const { resend, status, busy } = useResendVerification();

  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const profile = await api<{ emailVerified: boolean }>("/api/settings").catch(() => null);
      if (profile?.emailVerified) window.location.reload();
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  return (
    <section className="start">
      <div className="start-inner verify-inner">
        <button className="btn mobile-only open-sidebar" onClick={onOpenSidebar}>
          <MenuIcon size={16} /> Your trips
        </button>
        <p className="eyebrow">One last step</p>
        <h1>Confirm your email</h1>
        <p className="muted start-lede">
          We sent a link to <b>{email}</b>. Open it to confirm your address, and you&rsquo;re ready to start planning. Trips people share with
          you are already open to you.
        </p>
        <div className="card verify-card">
          <div className="verify-actions">
            <button className="btn primary" onClick={resend} disabled={busy}>
              {busy ? "Sending…" : "Send the email again"}
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              I&rsquo;ve confirmed it
            </button>
          </div>
          {status && (
            <p className={`settings-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
              {status.text}
            </p>
          )}
          <p className="muted small">
            Wrong address? <Link href="/settings">Change it in Settings</Link>. The link works for 24 hours; sending a new email replaces it.
          </p>
        </div>
      </div>
    </section>
  );
}
