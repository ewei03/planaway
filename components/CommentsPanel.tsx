"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  anchorKey,
  api,
  canEdit,
  timeAgo,
  type CommentAnchor,
  type CommentView,
  type Itinerary,
  type SessionUser,
  type TripView,
} from "./client";
import { useDialogs } from "./Dialogs";

interface Thread {
  root: CommentView;
  replies: CommentView[];
}

function threadsOf(comments: CommentView[]): Thread[] {
  const byRoot = new Map<string, Thread>();
  for (const c of comments) if (!c.parentId) byRoot.set(c.id, { root: c, replies: [] });
  for (const c of comments) if (c.parentId) byRoot.get(c.parentId)?.replies.push(c);
  return [...byRoot.values()];
}

/** Ids of everything in the itinerary, to flag comments whose item was removed. */
function itemIds(it: Itinerary | null): Set<string> {
  const ids = new Set<string>();
  if (!it) return ids;
  for (const x of [...it.flights, ...it.lodging, ...it.budget.breakdown, ...it.days]) ids.add(x.id);
  for (const d of it.days) for (const a of d.activities) ids.add(a.id);
  return ids;
}

interface Props {
  trip: TripView;
  user: SessionUser;
  /** Show one item's threads, or all threads when null. */
  anchor: CommentAnchor | null;
  onAnchor: (anchor: CommentAnchor | null) => void;
  onClose: () => void;
  /** Refetch the trip after a change. */
  onChanged: () => void;
  onAskAgent: () => void;
  agentBusy: boolean;
  onError: (message: string) => void;
}

export function CommentsPanel({ trip, user, anchor, onAnchor, onClose, onChanged, onAskAgent, agentBusy, onError }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const all = useMemo(() => threadsOf(trip.comments), [trip.comments]);
  const ids = useMemo(() => itemIds(trip.itinerary), [trip.itinerary]);
  const threads = anchor
    ? all.filter((t) => anchorKey(t.root.targetType, t.root.targetId) === anchorKey(anchor.type, anchor.id))
    : all.filter((t) => Boolean(t.root.resolvedAt) === showResolved);
  const openCount = all.filter((t) => !t.root.resolvedAt).length;

  const post = async (payload: object) => {
    setSending(true);
    try {
      await api(`/api/trips/${trip.id}/comments`, { method: "POST", body: JSON.stringify(payload) });
      onChanged();
      return true;
    } catch (err) {
      onError((err as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  };

  const startThread = async (e: FormEvent) => {
    e.preventDefault();
    if (!anchor || !draft.trim()) return;
    if (await post({ body: draft, targetType: anchor.type, targetId: anchor.id, targetLabel: anchor.label })) setDraft("");
  };

  return (
    <aside className="comments-panel" aria-label="Comments">
      <div className="cp-head">
        {anchor ? (
          <button className="link-btn" onClick={() => onAnchor(null)}>
            ← All comments
          </button>
        ) : (
          <strong>Comments</strong>
        )}
        <button className="btn icon" aria-label="Close comments" onClick={onClose}>
          ✕
        </button>
      </div>

      {anchor ? (
        <>
          <div className="cp-anchor">{anchor.label}</div>
          <form className="cp-new" onSubmit={startThread}>
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Too pricey? Prefer vegetarian? Leave a note for the group…"
            />
            <button className="btn primary" disabled={sending || !draft.trim()}>
              Comment
            </button>
          </form>
        </>
      ) : (
        <div className="cp-filter">
          <button className={`chip-btn ${!showResolved ? "active" : ""}`} onClick={() => setShowResolved(false)}>
            Open ({openCount})
          </button>
          <button className={`chip-btn ${showResolved ? "active" : ""}`} onClick={() => setShowResolved(true)}>
            Resolved ({all.length - openCount})
          </button>
        </div>
      )}

      {!anchor && !showResolved && openCount > 0 && canEdit(trip.role) && (
        <button className="btn block ask-agent" disabled={agentBusy} onClick={onAskAgent}>
          ✨ Ask PlanAway to address open comments
        </button>
      )}

      <div className="cp-threads">
        {threads.length === 0 && (
          <p className="muted cp-empty">
            {anchor ? "No comments here yet." : showResolved ? "No resolved comments." : "No open comments. Click 💬 next to anything in the itinerary to start one."}
          </p>
        )}
        {threads.map((t) => (
          <ThreadView
            key={t.root.id}
            thread={t}
            trip={trip}
            user={user}
            showTarget={!anchor}
            removed={t.root.targetId !== null && !ids.has(t.root.targetId)}
            onFocus={() => onAnchor({ type: t.root.targetType, id: t.root.targetId, label: t.root.targetLabel })}
            onReply={(body) => post({ parentId: t.root.id, body })}
            onChanged={onChanged}
            onError={onError}
          />
        ))}
      </div>
    </aside>
  );
}

interface ThreadProps {
  thread: Thread;
  trip: TripView;
  user: SessionUser;
  showTarget: boolean;
  removed: boolean;
  onFocus: () => void;
  onReply: (body: string) => Promise<boolean>;
  onChanged: () => void;
  onError: (message: string) => void;
}

function ThreadView({ thread, trip, user, showTarget, removed, onFocus, onReply, onChanged, onError }: ThreadProps) {
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const dialogs = useDialogs();
  const { root } = thread;
  const canResolve = canEdit(trip.role) || root.author?.id === user.id;

  const act = async (path: string, init: RequestInit) => {
    try {
      await api(`/api/trips/${trip.id}/comments/${path}`, init);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const submitReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    if (await onReply(reply)) {
      setReply("");
      setReplying(false);
    }
  };

  return (
    <div className={`thread ${root.resolvedAt ? "resolved" : ""}`}>
      {showTarget && (
        <button className="thread-target link-btn" onClick={onFocus}>
          {root.targetLabel}
          {removed && <span className="muted"> (removed from plan)</span>}
        </button>
      )}
      {[root, ...thread.replies].map((c) => (
        <div className="comment" key={c.id}>
          <div className="comment-meta">
            <span className={`comment-author ${c.author ? "" : "agent"}`}>{c.author?.name ?? "✨ PlanAway"}</span>
            <span className="muted">{timeAgo(c.createdAt)}</span>
            {(c.author?.id === user.id || trip.role === "owner") && (
              <button
                className="link-btn danger-text"
                onClick={async () => {
                  const ok = await dialogs.confirm({
                    title: c.parentId ? "Delete this reply?" : "Delete this comment?",
                    message: c.parentId ? undefined : "Its replies will be deleted too.",
                    danger: true,
                  });
                  if (ok) act(c.id, { method: "DELETE" });
                }}
              >
                Delete
              </button>
            )}
          </div>
          <div className="comment-body">{c.body}</div>
        </div>
      ))}
      <div className="thread-actions">
        {!replying && (
          <button className="link-btn" onClick={() => setReplying(true)}>
            Reply
          </button>
        )}
        {canResolve && (
          <button
            className="link-btn"
            onClick={() => act(root.id, { method: "PATCH", body: JSON.stringify({ resolved: !root.resolvedAt }) })}
          >
            {root.resolvedAt ? "Reopen" : "Resolve"}
          </button>
        )}
        {root.resolvedAt && <span className="muted">Resolved</span>}
      </div>
      {replying && (
        <form className="cp-new" onSubmit={submitReply}>
          <textarea rows={2} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" />
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => setReplying(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!reply.trim()}>
              Reply
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
