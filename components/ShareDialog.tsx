"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDate, type TripSharing } from "./client";
import { useDialogs } from "./Dialogs";
import { CheckIcon, CopyIcon } from "./icons";

interface Props {
  tripId: string;
  tripTitle: string;
  /** "Everyone in <group> can also see this trip", for shared groups. */
  groupName: string | null;
  onClose: () => void;
  onError: (message: string) => void;
}

const EXPIRY_OPTIONS: [string, number | null][] = [
  ["Expires in 1 day", 1],
  ["Expires in 7 days", 7],
  ["Expires in 30 days", 30],
  ["Never expires", null],
];

/** Invite links for one trip, and the people who joined through them. */
export function ShareDialog({ tripId, tripTitle, groupName, onClose, onError }: Props) {
  const [sharing, setSharing] = useState<TripSharing | null>(null);
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [expiry, setExpiry] = useState("7");
  const [copied, setCopied] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogs = useDialogs();

  // Latest callbacks, so `load` only changes when the trip does.
  const callbacks = useRef({ onClose, onError });
  callbacks.current = { onClose, onError };

  const load = useCallback(async () => {
    try {
      setSharing(await api<TripSharing>(`/api/trips/${tripId}/sharing`));
    } catch (err) {
      callbacks.current.onError((err as Error).message);
      callbacks.current.onClose();
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const call = async (path: string, init: RequestInit) => {
    try {
      await api(path, init);
      await load();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      onError("Couldn't copy. Select the link and copy it manually.");
    }
  };

  const createInvite = async () => {
    try {
      const { token } = await api<{ token: string }>(`/api/trips/${tripId}/invites`, {
        method: "POST",
        body: JSON.stringify({ role, expiresInDays: expiry === "never" ? null : Number(expiry) }),
      });
      await load();
      copy(token);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} onCancel={onClose}>
      <div className="dialog-head">
        <h2>Share “{tripTitle}”</h2>
        <button className="btn icon" aria-label="Close" onClick={() => dialogRef.current?.close()}>
          ✕
        </button>
      </div>

      {!sharing ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="dialog-body">
          <h3 className="dialog-section">Invite link</h3>
          <div className="inline wrap">
            <select className="invite-role" aria-label="Invite role" value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
              <option value="viewer">Can view</option>
              <option value="editor">Can edit</option>
            </select>
            <select className="invite-expiry" aria-label="Link expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY_OPTIONS.map(([label, days]) => (
                <option key={label} value={days === null ? "never" : String(days)}>
                  {label}
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={createInvite}>
              Create link
            </button>
          </div>
          {sharing.invites.length > 0 && (
            <ul className="invites">
              {sharing.invites.map((inv) => (
                <li key={inv.token}>
                  <input
                    readOnly
                    aria-label="Invite link"
                    title={`${inv.role === "editor" ? "Can edit" : "Can view"} · ${inv.expiresAt ? `expires ${formatDate(inv.expiresAt)}` : "never expires"}`}
                    value={inviteUrl(inv.token)}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="icon-btn"
                    aria-label={copied === inv.token ? "Copied" : "Copy invite link"}
                    title={copied === inv.token ? "Copied" : "Copy"}
                    onClick={() => copy(inv.token)}
                  >
                    {copied === inv.token ? <CheckIcon /> : <CopyIcon />}
                  </button>
                  <button
                    className="icon-btn danger-text"
                    aria-label="Revoke invite"
                    title="Revoke"
                    onClick={() => call(`/api/trips/${tripId}/invites/${inv.token}`, { method: "DELETE" })}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            Anyone with the link can see this trip's details, then sign in to join. It gives access to this trip only.
          </p>

          <h3 className="dialog-section">People with access</h3>
          {sharing.members.length === 0 ? (
            <p className="muted small">Nobody has joined through a link yet.</p>
          ) : (
            <ul className="members">
              {sharing.members.map((m) => (
                <li key={m.id}>
                  <span className="avatar" aria-hidden="true">
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="member-main">
                    <span className="member-name">{m.name}</span>
                    <span className="muted member-email">{m.email}</span>
                  </span>
                  <select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    onChange={(e) => call(`/api/trips/${tripId}/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) })}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    className="icon-btn danger-text"
                    aria-label={`Remove ${m.name}`}
                    title="Remove access"
                    onClick={async () => {
                      const ok = await dialogs.confirm({
                        title: `Remove ${m.name}?`,
                        message: `They'll lose access to ${tripTitle}.`,
                        confirmText: "Remove",
                        danger: true,
                      });
                      if (ok) call(`/api/trips/${tripId}/members/${m.id}`, { method: "DELETE" });
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {groupName && <p className="muted small">Everyone in {groupName} can also see this trip.</p>}
        </div>
      )}
    </dialog>
  );
}
