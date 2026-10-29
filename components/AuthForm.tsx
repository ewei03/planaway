"use client";

import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";
import { api } from "./client";

export function AuthForm({ callbackUrl }: { callbackUrl: string }) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await api("/api/register", { method: "POST", body: JSON.stringify({ name, email, password }) });
      }
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) {
        setError("Wrong email or password.");
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
    <main className="auth-page">
      <div className="auth-card card">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ✈
          </span>
          <span>PlanAway</span>
        </div>
        <h1>{registering ? "Create your account" : "Welcome back"}</h1>
        <p className="muted">{registering ? "Plan trips with an AI agent, together with your group." : "Sign in to your trips."}</p>

        <form onSubmit={submit}>
          {registering && (
            <>
              <label htmlFor="name">Name</label>
              <input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
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
          {registering && <p className="muted small">At least 8 characters.</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary block" disabled={busy}>
            {busy ? "One moment…" : registering ? "Create account" : "Sign in"}
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
    </main>
  );
}
