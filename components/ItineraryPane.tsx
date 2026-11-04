"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { buildRoute, type Route } from "@/lib/route";
import { createMapFocus, MapFocusProvider } from "./mapFocus";
import { useFoundPlaces, useLegs, usePlaces, type FindPlace } from "./places";
import { TripMap } from "./TripMap";
import { BookmarkIcon, ChevronDownIcon, CommentIcon, DownloadIcon, HistoryIcon, LogoIcon, MenuIcon, PlusIcon, UserPlusIcon } from "./icons";
import { ItinerarySkeleton } from "./Skeleton";
import { Viewers } from "./Viewers";

const NO_ROUTE: Route = { days: [], flights: [], lodging: [], points: [] };

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
  /** Opens the Share dialog; passed only to the trip's owner, who is the one who can invite. */
  onShare?: () => void;
  /** The chat is collapsed: offer to bring it back (wide screens only). */
  chatHidden?: boolean;
  onShowChat?: () => void;
  /** Set while the sidebar is collapsed, so it can be reopened with the chat hidden. */
  onShowTrips?: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

export function ItineraryPane(props: Props) {
  const { trip, user, viewing, viewers = [], working, onView, onSaveVersion, onExport, onBack, onChanged, onError } = props;
  const { chatHidden = false, onShowChat, onShowTrips, onShare } = props;
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
  const { lookup: searched, loading: placesLoading } = usePlaces(itinerary);
  const { lookup, find } = useFoundPlaces(itinerary, searched);
  const route = useMemo(() => (itinerary ? buildRoute(itinerary, lookup) : NO_ROUTE), [itinerary, lookup]);
  const { legs, loading: legsLoading } = useLegs(route);
  // What the map is focused on; a fresh start for each trip.
  const focus = useMemo(createMapFocus, [trip.id]);

  // An activity found on request is shown on the map once the route has it.
  const showFound = useRef<string | null>(null);
  const findPlace = useCallback<FindPlace>(
    async (day, activity) => {
      showFound.current = activity.id;
      const ok = await find(day, activity).catch(() => false);
      if (!ok) showFound.current = null;
      return ok;
    },
    [find],
  );
  useEffect(() => {
    const stop = showFound.current && route.days.flatMap((d) => d.stops).find((s) => s.id === showFound.current);
    if (!stop) return;
    showFound.current = null;
    focus.pick({ day: stop.day!, from: stop.order!, to: stop.order! }, { dock: true });
  }, [route, focus]);

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
        {chatHidden && onShowTrips && (
          <button className="btn wide-only panel-open" aria-label="Show trips" title="Show trips" onClick={onShowTrips}>
            <MenuIcon size={16} /> Trips
          </button>
        )}
        {chatHidden && onShowChat && (
          <button className="btn wide-only panel-open" aria-label="Show chat" title="Show chat" onClick={onShowChat}>
            <LogoIcon size={16} /> Chat
          </button>
        )}
        {/* Versions in one control: pick one, or save the draft as a new one. */}
        <div className="version-group">
          <label className={`version-picker ${viewing !== "current" ? "saved" : ""}`}>
            <HistoryIcon size={16} />
            <select aria-label="Itinerary version" value={viewing} onChange={(e) => onView(e.target.value)}>
              <option value="current">Current draft</option>
              {[...trip.versions].reverse().map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {formatDateTime(v.savedAt)}
                </option>
              ))}
            </select>
            <ChevronDownIcon size={14} />
          </label>
          {canEdit(trip.role) && (
            <button
              className="version-save"
              aria-label="Save version"
              title={viewing === "current" ? "Save the current draft as a version" : "Switch to the current draft to save it"}
              disabled={!trip.itinerary || viewing !== "current"}
              onClick={onSaveVersion}
            >
              <BookmarkIcon size={16} />
              <span className="btn-label">Save</span>
            </button>
          )}
        </div>
        <Viewers me={user} viewers={viewers} />
        {onShare && (
          // An empty seat beside the faces: the plainest hint that others can join.
          <button className="invite-circle" aria-label="Invite people" title="Invite people to this trip" onClick={onShare}>
            <PlusIcon size={16} />
          </button>
        )}
        <div className="toolbar-actions">
          <button
            className={`btn comments-btn ${commentAnchor !== undefined ? "pressed" : ""}`}
            aria-label={openCount > 0 ? `Comments, ${openCount} open` : "Comments"}
            onClick={() => setCommentAnchor(commentAnchor === undefined ? null : undefined)}
          >
            <CommentIcon size={16} />
            <span className="btn-label">Comments</span>
            {openCount > 0 && (
              <span className="count-badge" aria-hidden="true">
                {openCount}
              </span>
            )}
          </button>
          <div className="menu">
            <button
              className="btn"
              aria-label="Export"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              disabled={!itinerary}
              onClick={(e) => {
                e.stopPropagation();
                setExportOpen((o) => !o);
              }}
            >
              <DownloadIcon size={16} />
              <span className="btn-label">Export</span>
              <ChevronDownIcon size={14} />
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
          {onShare && (
            <button className="btn primary share-btn" aria-label="Share" onClick={onShare}>
              <UserPlusIcon size={16} />
              <span className="btn-label">Share</span>
            </button>
          )}
        </div>
      </div>
      <div className="pane-body">
        <div className="itinerary">
          {itinerary ? (
            <MapFocusProvider value={focus}>
              <ItineraryView
                itinerary={itinerary}
                tripId={trip.id}
                counts={counts}
                onComment={setCommentAnchor}
                lookup={lookup}
                legs={legs}
                onFind={findPlace}
                map={<TripMap route={route} legs={legs} loading={placesLoading} routing={legsLoading} />}
              />
            </MapFocusProvider>
          ) : (
            working ? (
              <ItinerarySkeleton label="Researching your trip…" caption="Researching your trip. The itinerary will appear here." />
            ) : (
              <p className="it-empty">No itinerary yet. Describe your trip in the chat to get started.</p>
            )
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
            onError={onError}
          />
        )}
      </div>
    </div>
  );
}
