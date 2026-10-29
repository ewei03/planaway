"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDate, type GroupDetail, type Role, type SessionUser } from "./client";
import { useDialogs } from "./Dialogs";

interface Props {
  groupId: string;
  user: SessionUser;
  onClose: () => void;
  /** Group list changed (rename, membership). */
  onChanged: () => void;
  /** The user left or deleted the group. */
  onGone: () => void;
  onError: (message: string) => void;
}

const ROLE_HELP: Record<Role, string> = {
  owner: "Manage members and delete",
  editor: "Plan with the agent",
  viewer: "View and comment",
};

export function GroupDialog({ groupId, user, onClose, onChanged, onGone, onError }: Props) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [name, setName] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [copied, setCopied] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogs = useDialogs();

  // Latest callbacks, so `load` only changes when the group does.
  const callbacks = useRef({ onClose, onError });
  callbacks.current = { onClose, onError };

  const load = useCallback(async () => {
    try {
      const g = await api<GroupDetail>(`/api/groups/${groupId}`);
      setGroup(g);
      setName(g.name);
    } catch (err) {
      callbacks.current.onError((err as Error).message);
      callbacks.current.onClose();
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const call = async (path: string, init: RequestInit, after: "reload" | "gone" = "reload") => {
    try {
      await api(path, init);
      onChanged();
      if (after === "gone") onGone();
      else await load();
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
      const { token } = await api<{ token: string }>(`/api/groups/${groupId}/invites`, {
        method: "POST",
        body: JSON.stringify({ role: inviteRole }),
      });
      await load();
      copy(token);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const isOwner = group?.role === "owner";

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} onCancel={onClose}>
      <div className="dialog-head">
        <h2>{group?.name ?? "Group"}</h2>
        <button className="btn icon" aria-label="Close" onClick={() => dialogRef.current?.close()}>
          ✕
        </button>
      </div>

      {!group ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="dialog-body">
          {isOwner && (
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== group.name) {
                  call(`/api/groups/${groupId}`, { method: "PATCH", body: JSON.stringify({ name }) });
                }
              }}
            >
              <input aria-label="Group name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn" disabled={!name.trim() || name.trim() === group.name}>
                Rename
              </button>
            </form>
          )}

          <h3 className="dialog-section">Members</h3>
          <ul className="members">
            {group.members.map((m) => (
              <li key={m.id}>
                <span className="avatar" aria-hidden="true">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="member-main">
                  <span className="member-name">
                    {m.name}
                    {m.id === user.id && <span className="muted"> (you)</span>}
                  </span>
                  <span className="muted member-email">{m.email}</span>
                </span>
                {isOwner ? (
                  <select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    onChange={(e) =>
                      call(`/api/groups/${groupId}/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) })
                    }
                  >
                    <option value="owner">Owner</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <span className="role-badge">{m.role}</span>
                )}
                {isOwner && m.id !== user.id && (
                  <button
                    className="icon-btn danger-text"
                    aria-label={`Remove ${m.name}`}
                    title="Remove from group"
                    onClick={async () => {
                      const ok = await dialogs.confirm({
                        title: `Remove ${m.name}?`,
                        message: `They'll lose access to ${group.name} and its trips.`,
                        confirmText: "Remove",
                        danger: true,
                      });
                      if (ok) call(`/api/groups/${groupId}/members/${m.id}`, { method: "DELETE" });
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Owners: {ROLE_HELP.owner.toLowerCase()}. Editors: {ROLE_HELP.editor.toLowerCase()}. Viewers: {ROLE_HELP.viewer.toLowerCase()}.
          </p>

          {isOwner && (
            <>
              <h3 className="dialog-section">Invite people</h3>
              <div className="inline">
                <select aria-label="Invite role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}>
                  <option value="editor">As editor</option>
                  <option value="viewer">As viewer</option>
                </select>
                <button className="btn primary" onClick={createInvite}>
                  Create invite link
                </button>
              </div>
              {group.invites.length > 0 && (
                <ul className="invites">
                  {group.invites.map((inv) => (
                    <li key={inv.token}>
                      <input readOnly aria-label="Invite link" value={inviteUrl(inv.token)} onFocus={(e) => e.target.select()} />
                      <span className="muted small">
                        {inv.role} · expires {formatDate(inv.expiresAt)}
                      </span>
                      <button className="btn" onClick={() => copy(inv.token)}>
                        {copied === inv.token ? "Copied" : "Copy"}
                      </button>
                      <button
                        className="icon-btn danger-text"
                        aria-label="Revoke invite"
                        title="Revoke"
                        onClick={() => call(`/api/groups/${groupId}/invites/${inv.token}`, { method: "DELETE" })}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted small">Anyone with a link can join until it expires or you revoke it.</p>
            </>
          )}

          <div className="dialog-footer">
            <button
              className="btn"
              onClick={async () => {
                const ok = await dialogs.confirm({
                  title: `Leave ${group.name}?`,
                  message: "You'll lose access to its trips until someone invites you again.",
                  confirmText: "Leave",
                  danger: true,
                });
                if (ok) call(`/api/groups/${groupId}/members/${user.id}`, { method: "DELETE" }, "gone");
              }}
            >
              Leave group
            </button>
            {isOwner && (
              <button
                className="btn danger-text"
                onClick={async () => {
                  const ok = await dialogs.confirm({
                    title: `Delete ${group.name}?`,
                    message: "This deletes the group and all of its trips for everyone. It can't be undone.",
                    danger: true,
                  });
                  if (ok) call(`/api/groups/${groupId}`, { method: "DELETE" }, "gone");
                }}
              >
                Delete group
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
