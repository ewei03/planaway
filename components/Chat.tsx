"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { canEdit, type SessionUser, type TripView } from "./client";
import { Markdown } from "./Markdown";

/** A turn this tab sent that isn't in the saved chat log yet: in flight, or failed. */
export interface LiveTurn {
  text: string;
  reply: string;
  error: string | null;
}

interface Props {
  trip: TripView;
  user: SessionUser;
  live: LiveTurn[];
  working: boolean;
  status: string;
  onSend: (text: string) => void;
  onRename: (title: string) => void;
  onOpenSidebar: () => void;
  onShowItinerary: () => void;
}

export function Chat({ trip, user, live, working, status, onSend, onRename, onOpenSidebar, onShowItinerary }: Props) {
  const [draft, setDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const editable = canEdit(trip.role);

  // Keep the newest message in view as the reply streams in.
  const lastReply = live.at(-1)?.reply;
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [trip.id, trip.chat.length, live.length, lastReply]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || working) return;
    setDraft("");
    onSend(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const commitTitle = () => {
    const title = editingTitle?.trim();
    setEditingTitle(null);
    if (title && title !== trip.title) onRename(title);
  };

  return (
    <div className="chat">
      <div className="chat-header">
        <button className="btn icon mobile-only open-sidebar" aria-label="Show trips" onClick={onOpenSidebar}>
          ☰
        </button>
        <div className="chat-title">
          {editingTitle === null ? (
            <h1
              className={`trip-title ${editable ? "editable" : ""}`}
              title={editable ? "Click to rename" : undefined}
              onClick={() => editable && setEditingTitle(trip.title)}
            >
              {trip.title}
            </h1>
          ) : (
            <input
              className="trip-title-input"
              aria-label="Trip name"
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") setEditingTitle(null);
              }}
            />
          )}
          <span className="trip-group muted">
            {/* Another person's group name means nothing to someone the trip was shared with. */}
            {trip.sharedBy ? `Shared by ${trip.sharedBy.name}` : trip.groupName} · {trip.role}
          </span>
        </div>
        <button className="btn icon mobile-only" id="show-itinerary" aria-label="Show itinerary" onClick={onShowItinerary}>
          🗺
        </button>
      </div>

      <div className="messages" ref={messagesRef} aria-live="polite">
        {trip.chat.length === 0 && live.length === 0 && (
          <p className="muted chat-empty">
            {editable ? "Describe the trip to get started. Everyone in the group sees this conversation." : "No messages yet."}
          </p>
        )}
        {trip.chat.map((m) =>
          m.role === "user" ? (
            <UserMessage key={m.id} text={m.text} author={m.author?.name ?? "Former member"} mine={m.author?.id === user.id} />
          ) : (
            <div key={m.id} className="msg assistant">
              <Markdown text={m.text || "(no reply)"} />
            </div>
          ),
        )}
        {live.map((turn, i) => (
          <div key={i} className="live-turn">
            <UserMessage text={turn.text} author={user.name} mine />
            {turn.error ? (
              <div className="msg error">{turn.error}</div>
            ) : (
              turn.reply && (
                <div className="msg assistant">
                  <Markdown text={turn.reply} />
                </div>
              )
            )}
          </div>
        ))}
      </div>

      {working && (
        <div className="status">
          <span className="spinner" aria-hidden="true" />
          <span className="status-text">{status}</span>
        </div>
      )}

      {editable ? (
        <form className="composer" onSubmit={submit}>
          <textarea
            rows={2}
            value={draft}
            disabled={working}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Refine the plan: “cheaper hotels”, “add a day trip to Nara”, “swap day 3 and 4”…"
          />
          <button className="btn primary" type="submit" disabled={working}>
            Send
          </button>
        </form>
      ) : (
        <div className="composer view-only muted">You have view access. You can still comment on the itinerary with 💬.</div>
      )}
    </div>
  );
}

function UserMessage({ text, author, mine }: { text: string; author: string; mine: boolean }) {
  return (
    <div className={`msg-wrap ${mine ? "mine" : "theirs"}`}>
      {!mine && <div className="msg-author">{author}</div>}
      <div className={`msg user ${mine ? "" : "other"}`}>{text}</div>
    </div>
  );
}
