"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "./client";
import { MenuIcon } from "./icons";

type Status = { kind: "ok" | "error"; text: string } | null;

/** Asks for a new confirmation code for `email`, and says what happened. */
export async function sendVerifyCode(email: string): Promise<Status> {
  try {
    await api("/api/verify-email", { method: "POST", body: JSON.stringify({ email }) });
    return { kind: "ok", text: "Sent a new code. Check your inbox, and your spam folder just in case." };
  } catch (err) {
    return { kind: "error", text: (err as Error).message };
  }
}

/**
 * Entering the 6-digit code emailed to `email`, with "Send a new code".
 * Not a <form>, so it can sit inside another one (Settings). `onVerified`
 * runs once the code is accepted; if it throws, its message is shown.
 */
export function VerifyCodeForm({
  email,
  onVerified,
  initialStatus = null,
  submitLabel = "Confirm email",
}: {
  email: string;
  onVerified: () => Promise<void> | void;
  initialStatus?: Status;
  submitLabel?: string;
}) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await api("/api/verify-email/confirm", { method: "POST", body: JSON.stringify({ email, code }) });
      await onVerified();
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
      setBusy(false);
    }
    // On success, stay busy: the caller is moving on (signing in, reloading).
  };

  const resend = async () => {
    setSending(true);
    setStatus(null);
    setStatus(await sendVerifyCode(email));
    setCode("");
    setSending(false);
  };

  return (
    <div className="verify-code-form">
      <label htmlFor="verify-code">Confirmation code</label>
      <input
        id="verify-code"
        className="verify-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void confirm();
          }
        }}
      />
      {status && (
        <p className={status.kind === "error" ? "form-error" : "settings-status ok"} role={status.kind === "error" ? "alert" : "status"}>
          {status.text}
        </p>
      )}
      <button type="button" className="btn primary block" onClick={confirm} disabled={busy || code.length !== 6}>
        {busy ? "Confirming…" : submitLabel}
      </button>
      <p className="muted small">
        Didn&rsquo;t get it?{" "}
        <button type="button" className="link-btn" onClick={resend} disabled={sending}>
          {sending ? "Sending…" : "Send a new code"}
        </button>
        . Codes work for 30 minutes; a new one replaces the old.
      </p>
    </div>
  );
}

/**
 * In place of the start screen while a signed-in user's address isn't
 * confirmed, which happens after changing it in Settings. (New accounts
 * confirm theirs before they can sign in.)
 */
export function VerifyEmailPrompt({ email, onOpenSidebar }: { email: string; onOpenSidebar: () => void }) {
  return (
    <section className="start">
      <div className="start-inner verify-inner">
        <button className="btn mobile-only open-sidebar" onClick={onOpenSidebar}>
          <MenuIcon size={16} /> Your trips
        </button>
        <p className="eyebrow">One last step</p>
        <h1>Confirm your email</h1>
        <p className="muted start-lede">
          We sent a 6-digit code to <b>{email}</b>. Enter it to confirm your address, and you&rsquo;re ready to start planning. Trips people share
          with you are already open to you.
        </p>
        <div className="card verify-card">
          <VerifyCodeForm email={email} onVerified={() => window.location.reload()} />
          <p className="muted small">
            Wrong address? <Link href="/settings">Change it in Settings</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}
