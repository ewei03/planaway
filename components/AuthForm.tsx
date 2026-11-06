"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { today } from "@/lib/account";
import { AuthArt } from "./AuthArt";
import { api } from "./client";
import { LogoIcon } from "./icons";
import { SiteFooter } from "./SiteFooter";
import { sendVerifyCode, VerifyCodeForm } from "./VerifyEmail";

export function AuthForm({ callbackUrl, notice }: { callbackUrl: string; /** A message shown above the form, e.g. after deleting an account. */ notice?: string }) {
  // "verify": the account exists, and waits for the code emailed to it before signing in.
  const [mode, setMode] = useState<"signin" | "register" | "verify">("signin");
  const [verifyStatus, setVerifyStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Signs in with the details typed above, and opens the app. Returns false when the address still needs its code. */
  const signInAndGo = async (): Promise<boolean> => {
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.code === "unverified") return false;
    if (!res || res.error) {
      throw new Error(
        res?.code === "too_many_tries"
          ? "Too many wrong passwords. Wait 15 minutes and try again, or reset your password."
          : "Wrong email or password.",
      );
    }
    // Full navigation so the server renders with the new session.
    window.location.assign(callbackUrl);
    return true;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirmPassword) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        // Registering emails a code; the app opens once it's entered.
        await api("/api/register", { method: "POST", body: JSON.stringify({ name, email, password, birthDate }) });
        setVerifyStatus(null);
        setMode("verify");
        return;
      }
      if (!(await signInAndGo())) {
        // Signed up earlier but never confirmed: send a fresh code and ask for it.
        const sent = await sendVerifyCode(email);
        setVerifyStatus(sent?.kind === "error" ? sent : { kind: "ok", text: "" });
        setMode("verify");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishVerifying = async () => {
    if (!(await signInAndGo())) throw new Error("That didn't work. Try the code again.");
  };

  if (mode === "verify") {
    return (
      <div className="auth-split">
        <AuthArt />
        <main className="auth-page">
          <div className="auth-card" key={mode}>
            <div className="brand">
              <span className="logo" aria-hidden="true">
                <LogoIcon />
              </span>
              <span className="brand-name">PlanAway</span>
            </div>
            <h1>Check your email</h1>
            <p className="muted">
              We sent a 6-digit code to <b>{email}</b>. Enter it to confirm your address, and we&rsquo;ll sign you in.
            </p>
            <VerifyCodeForm email={email} onVerified={finishVerifying} initialStatus={verifyStatus} submitLabel="Confirm and sign in" />
            <p className="auth-switch muted">
              {" "}
              <button
                className="link-btn"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
              >
                Back to sign in
              </button>
            </p>
          </div>
          <SiteFooter />
        </main>
      </div>
    );
  }

  const registering = mode === "register";

  return (
    <div className="auth-split">
      <AuthArt />
      <main className="auth-page">
        {/* Keyed by mode so switching between sign-in and sign-up replays the entrance; the typed values live in state above. */}
        <div className="auth-card" key={mode}>
          <div className="brand">
            <span className="logo" aria-hidden="true">
              <LogoIcon />
            </span>
            <span className="brand-name">PlanAway</span>
          </div>
          <h1>{registering ? "Create your account" : "Welcome back"}</h1>
          <p className="muted">{registering ? "Plan trips together with your friends." : "Sign in to your trips."}</p>
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}

          <form onSubmit={submit}>
            {registering && (
              <>
                <label htmlFor="name">Name</label>
                <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
                {/* Only rendered after a click, so today() can't differ between server and browser. */}
                <label htmlFor="birth-date">Date of birth</label>
                <input
                  id="birth-date"
                  type="date"
                  autoComplete="bday"
                  required
                  max={today()}
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
              </>
            )}
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={registering ? "new-password" : "current-password"}
              minLength={registering ? 8 : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {registering ? (
              <>
                <p className="muted small">At least 8 characters.</p>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </>
            ) : (
              <p className="small auth-forgot">
                <Link href="/forgot-password">Forgot password?</Link>
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {registering && (
              <p className="muted small auth-legal">
                By creating an account, you agree to the <Link href="/terms">Terms of Use</Link> and acknowledge the{" "}
                <Link href="/privacy">Privacy Policy</Link>. We&rsquo;ll email you a link to confirm your address.
              </p>
            )}
            <button className="btn primary block" disabled={busy}>
              {busy ? "Signing in..." : registering ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="auth-switch muted">
            {registering ? "Already have an account?" : "New to PlanAway?"}{" "}
            <button
              className="link-btn"
              onClick={() => {
                setMode(registering ? "signin" : "register");
                setError(null);
              }}
            >
              {registering ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
        <SiteFooter />
      </main>
    </div>
  );
}
