"use client";

import { useEffect, useMemo, useState } from "react";
import {
  anchorKey,
  canEdit,
  downloadExport,
  formatDateTime,
  type CommentAnchor,
  type ExportFormat,
  type Itinerary,
  type SessionUser,
  type TripView,
} from "./client";
import { CommentsPanel } from "./CommentsPanel";
import { ItineraryView } from "./ItineraryView";

const FORMATS: [ExportFormat, string][] = [
  ["csv", "Spreadsheet (.csv)"],
  ["md", "Document (.md)"],
  ["ics", "Calendar (.ics)"],
  ["json", "Data (.json)"],
];

interface Props {
  trip: TripView;
  user: SessionUser;
  /** "current" or a saved version id */
  viewing: string;
  working: boolean;
  onView: (viewing: string) => void;
  onSaveVersion: () => void;
  onDelete: () => void;
  onBack: () => void;
  onChanged: () => void;
  onAskAgent: () => void;
  onError: (message: string) => void;
}

export function ItineraryPane(props: Props) {
  const { trip, user, viewing, working, onView, onSaveVersion, onDelete, onBack, onChanged, onAskAgent, onError } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  // undefined: panel closed; null: all comments; otherwise one item's threads.
  const [commentAnchor, setCommentAnchor] = useState<CommentAnchor | null | undefined>(undefined);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  // Close the comments panel when switching trips.
  useEffect(() => setCommentAnchor(undefined), [trip.id]);

  const itinerary: Itinerary | null =
    viewing === "current" ? trip.itinerary : (trip.versions.find((v) => v.id === viewing)?.itinerary ?? null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of trip.comments) {
      if (c.parentId || c.resolvedAt) continue;
      const k = anchorKey(c.targetType, c.targetId);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [trip.comments]);
  const openCount = [...counts.values()].reduce((a, b) => a + b, 0);

  const exportAs = (format: ExportFormat) => {
    setMenuOpen(false);
    downloadExport(trip.id, format, viewing === "current" ? null : viewing).catch((err: Error) => onError(err.message));
  };

  return (
    <div className="itinerary-pane">
      <div className="pane-toolbar">
        <button className="btn icon mobile-only" id="hide-itinerary" aria-label="Back to chat" onClick={onBack}>
          ←
        </button>
        <select aria-label="Itinerary version" value={viewing} onChange={(e) => onView(e.target.value)}>
          <option value="current">Current draft</option>
          {[...trip.versions].reverse().map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} · {formatDateTime(v.savedAt)}
            </option>
          ))}
        </select>
        <div className="toolbar-actions">
          <button
            className={`btn ${commentAnchor !== undefined ? "pressed" : ""}`}
            onClick={() => setCommentAnchor(commentAnchor === undefined ? null : undefined)}
          >
            💬{openCount > 0 ? ` ${openCount}` : ""}
          </button>
          {canEdit(trip.role) && (
            <button className="btn" disabled={!trip.itinerary || viewing !== "current"} onClick={onSaveVersion}>
              Save
            </button>
          )}
          <div className="menu">
            <button
              className="btn"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              disabled={!itinerary}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
            >
              Export ▾
            </button>
            {menuOpen && (
              <div className="menu-list" role="menu">
                {FORMATS.map(([format, label]) => (
                  <button key={format} role="menuitem" onClick={() => exportAs(format)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {trip.canDelete && (
            <button className="btn danger-text" title="Delete trip" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="pane-body">
        <div className="itinerary">
          {itinerary ? (
            <ItineraryView itinerary={itinerary} counts={counts} onComment={setCommentAnchor} />
          ) : (
            <p className="it-empty">
              {working
                ? "Researching your trip. The itinerary will appear here."
                : "No itinerary yet. Describe your trip in the chat to get started."}
            </p>
          )}
        </div>
        {commentAnchor !== undefined && (
          <CommentsPanel
            trip={trip}
            user={user}
            anchor={commentAnchor}
            onAnchor={setCommentAnchor}
            onClose={() => setCommentAnchor(undefined)}
            onChanged={onChanged}
            onAskAgent={onAskAgent}
            agentBusy={working}
            onError={onError}
          />
        )}
      </div>
    </div>
  );
}
