"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { today } from "@/lib/account";
import { AuthArt } from "./AuthArt";
import { api } from "./client";
import { LogoIcon } from "./icons";
import { SiteFooter } from "./SiteFooter";

export function AuthForm({ callbackUrl, notice }: { callbackUrl: string; /** A message shown above the form, e.g. after deleting an account. */ notice?: string }) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await api("/api/register", { method: "POST", body: JSON.stringify({ name, email, password, birthDate }) });
      }
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) {
        setError(
          res?.code === "too_many_tries"
            ? "Too many wrong passwords. Wait 15 minutes and try again, or reset your password."
            : "Wrong email or password.",
        );
        return;
      }
      // Full navigation so the server renders with the new session.
      window.location.assign(callbackUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
              <p className="muted small">At least 8 characters.</p>
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
