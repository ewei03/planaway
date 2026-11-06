"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "./client";

/** Asks for the account's email address and sends a reset link to it. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/password-reset", { method: "POST", body: JSON.stringify({ email }) });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <>
        <h1>Check your email</h1>
        <p className="muted" role="status">
          If there&rsquo;s a PlanAway account for <b>{email}</b>, we&rsquo;ve sent it a link to choose a new password. The link works for one
          hour. Nothing there? Check your spam folder.
        </p>
        <Link className="btn primary block" href="/login">
          Back to sign in
        </Link>
      </>
    );

  return (
    <>
      <h1>Forgot your password?</h1>
      <p className="muted">Enter the email address you sign in with, and we&rsquo;ll send you a link to choose a new password.</p>
      <form onSubmit={submit}>
        <label htmlFor="reset-email">Email</label>
        <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="auth-switch muted">
        Remembered it? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}

/**
 * Shown instead of the form while this server can't send email (no SMTP_HOST):
 * a reset link would never arrive, so it says who to ask instead.
 */
export function ForgotPasswordContact({ contactEmail, operator }: { contactEmail: string | null; operator: string }) {
  return (
    <>
      <h1>Forgot your password?</h1>
      <p className="muted" role="note">
        Password reset emails aren&rsquo;t set up yet.{" "}
        {contactEmail ? (
          <>
            To reset your password, email <a href={`mailto:${contactEmail}?subject=${encodeURIComponent("PlanAway password reset")}`}>{contactEmail}</a>{" "}
            from the address you sign in with.
          </>
        ) : (
          <>To reset your password, contact {operator} via email.</>
        )}
      </p>
      <Link className="btn primary block" href="/login">
        Back to sign in
      </Link>
    </>
  );
}

/** Sets a new password from the link in a reset email, then sends you to sign in with it. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) });
      window.location.assign("/login?reset=1");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Choose a new password</h1>
      <p className="muted">After this, sign in with your new password.</p>
      <form onSubmit={submit}>
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor="confirm-password">Confirm new password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <p className="muted small">At least 8 characters.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}{" "}
            {/expired|already used/.test(error) && <Link href="/forgot-password">Send a new link</Link>}
          </p>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </>
  );
}
