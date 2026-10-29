"use client";

import { useState } from "react";
import { api, type Role } from "./client";

export function AcceptInvite({ token, groupName, role }: { token: string; groupName: string; role: Role }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await api(`/api/invites/${token}`, { method: "POST" });
      window.location.assign("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Join {groupName}</h1>
      <p className="muted">
        You've been invited as {role === "editor" ? "an editor: you can plan trips with the agent" : "a viewer: you can view trips and comment"}.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary block" disabled={busy} onClick={accept}>
        {busy ? "Joining…" : `Join ${groupName}`}
      </button>
    </>
  );
}
