"use client";

import { useEffect, useMemo, useState } from "react";
import {
  anchorKey,
  canEdit,
  EXPORT_FORMATS,
  formatDateTime,
  type CommentAnchor,
  type ExportFormat,
  type Itinerary,
  type SessionUser,
  type TripView,
  type UserRef,
} from "./client";
import { CommentsPanel } from "./CommentsPanel";
import { ItineraryView } from "./ItineraryView";
import { usePlaces } from "./places";
import { TripMap } from "./TripMap";
import { Viewers } from "./Viewers";

interface Props {
  trip: TripView;
  user: SessionUser;
  /** "current" or a saved version id */
  viewing: string;
  /** Other people with this trip open right now. */
  viewers?: UserRef[];
  working: boolean;
  onView: (viewing: string) => void;
  onSaveVersion: () => void;
  /** Exports the version on screen. */
  onExport: (format: ExportFormat) => void;
  onBack: () => void;
  onChanged: () => void;
  onAskAgent: () => void;
  onError: (message: string) => void;
}

export function ItineraryPane(props: Props) {
  const { trip, user, viewing, viewers = [], working, onView, onSaveVersion, onExport, onBack, onChanged, onAskAgent, onError } = props;
  const [exportOpen, setExportOpen] = useState(false);
  // undefined: panel closed; null: all comments; otherwise one item's threads.
  const [commentAnchor, setCommentAnchor] = useState<CommentAnchor | null | undefined>(undefined);

  useEffect(() => {
    if (!exportOpen) return;
    const close = () => setExportOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  // Close the comments panel when switching trips.
  useEffect(() => setCommentAnchor(undefined), [trip.id]);

  const itinerary: Itinerary | null =
    viewing === "current" ? trip.itinerary : (trip.versions.find((v) => v.id === viewing)?.itinerary ?? null);
  const { lookup, loading: placesLoading } = usePlaces(itinerary);

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
          <Viewers viewers={viewers} />
          <button
            className={`btn ${commentAnchor !== undefined ? "pressed" : ""}`}
            onClick={() => setCommentAnchor(commentAnchor === undefined ? null : undefined)}
          >
            💬{openCount > 0 ? ` ${openCount}` : ""}
          </button>
          {canEdit(trip.role) && (
            <button
              className="btn"
              title={viewing === "current" ? "Save a snapshot of the current draft" : "Switch to the current draft to save it"}
              disabled={!trip.itinerary || viewing !== "current"}
              onClick={onSaveVersion}
            >
              Save
            </button>
          )}
          <div className="menu">
            <button
              className="btn"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              disabled={!itinerary}
              onClick={(e) => {
                e.stopPropagation();
                setExportOpen((o) => !o);
              }}
            >
              Export ▾
            </button>
            {exportOpen && (
              <div className="menu-list" role="menu" aria-label="Export as">
                {EXPORT_FORMATS.map(([format, label]) => (
                  <button
                    key={format}
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      onExport(format);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="pane-body">
        <div className="itinerary">
          {itinerary ? (
            <ItineraryView
              itinerary={itinerary}
              counts={counts}
              onComment={setCommentAnchor}
              lookup={lookup}
              map={<TripMap itinerary={itinerary} lookup={lookup} loading={placesLoading} />}
            />
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
