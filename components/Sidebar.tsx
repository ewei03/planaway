"use client";

import { useEffect, useRef, useState } from "react";
import { canEdit, EXPORT_FORMATS, formatTripDate, relativeTime, useMinuteTick, type ExportFormat, type SessionUser, type TripSummary } from "./client";
import { areaQuery } from "@/lib/route";
import Link from "next/link";
import { Avatar } from "./Avatar";
import { TripListSkeleton } from "./Skeleton";
import { CloseIcon, GearIcon, LogoIcon, PlusIcon } from "./icons";
import { credit, type PlaceLookup } from "./places";
import { SiteFooter } from "./SiteFooter";

type SortOrder = "newest" | "oldest" | "departure";
const SORT_KEY = "planaway:trip-sort";
const SORT_ORDERS: SortOrder[] = ["newest", "oldest", "departure"];

/** Sorts trips for the list. By departure, the soonest trip comes first and
 *  trips without dates yet go last, most recently updated first. */
export function sortTrips(trips: TripSummary[], order: SortOrder): TripSummary[] {
  const updated = (t: TripSummary) => Date.parse(t.updatedAt);
  return [...trips].sort((a, b) => {
    if (order === "departure") {
      if (a.startDate && b.startDate && a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
      if (!a.startDate !== !b.startDate) return a.startDate ? -1 : 1;
      return updated(b) - updated(a);
    }
    return order === "newest" ? updated(b) - updated(a) : updated(a) - updated(b);
  });
}

interface Props {
  user: SessionUser;
  /** The user's own trips and the ones shared with them, newest activity first. */
  trips: TripSummary[];
  /** True until the trips have loaded, so the list shows placeholders rather than "No trips yet." */
  loading?: boolean;
  activeId: string | null;
  /** Place photos for trip thumbnails; trips without one show their initial. */
  lookup?: PlaceLookup;
  onSelect: (id: string) => void;
  onNewTrip: () => void;
  onRename: (tripId: string) => void;
  onSaveVersion: (tripId: string) => void;
  onExport: (tripId: string, format: ExportFormat) => void;
  onShare: (tripId: string) => void;
  /** Moves the trip to the Completed section, or back out of it. */
  onComplete: (tripId: string, completed: boolean) => void;
  onDelete: (tripId: string) => void;
  onLeave: (tripId: string) => void;
  onSignOut: () => void;
  onHide: () => void;
}

/** The open trip menu, positioned next to its ⋯ button. It's fixed rather than
 *  absolute so the scrolling sidebar can't clip it. */
interface OpenMenu {
  tripId: string;
  top: number;
  left: number;
}

export function Sidebar(props: Props) {
  const { user, trips, loading = false, activeId, lookup, onSelect, onNewTrip, onSignOut, onHide } = props;
  const { onRename, onSaveVersion, onExport, onShare, onComplete, onDelete, onLeave } = props;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  useMinuteTick();

  // Remember the sort order across visits. Read after mount so the
  // server-rendered markup matches the first client render.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY) as SortOrder | null;
      if (saved && SORT_ORDERS.includes(saved)) setSort(saved);
    } catch {}
  }, []);

  const changeSort = (value: SortOrder) => {
    setSort(value);
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {}
  };
  const [exportOpen, setExportOpen] = useState(false);
  const [sort, setSort] = useState<SortOrder>("newest");
  // Opened from the keyboard: move focus into the submenu.
  const keyboardOpen = useRef(false);

  useEffect(() => {
    setExportOpen(false);
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    // Capture, so scrolling the sidebar (not just the window) closes it too.
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const run = (action: () => void) => {
    setMenu(null);
    action();
  };

  /** One trip row and its ⋯ menu. */
  const tripItem = (t: TripSummary) => {
    const open = menu?.tripId === t.id;
    const owner = t.role === "owner";
    const editable = canEdit(t.role);
    return (
      <li key={t.id} className={`trip-item ${t.id === activeId ? "active" : ""} ${open ? "menu-open" : ""}`}>
        <button className={`trip-open ${t.id === activeId ? "active" : ""}`} onClick={() => onSelect(t.id)}>
          <TripThumb trip={t} lookup={lookup} />
          <span className="t-text">
            <span className="t-title">{t.title}</span>
            <span className="t-meta">
              {sort === "departure" && t.startDate ? `Departs ${formatTripDate(t.startDate)}` : `Updated ${relativeTime(t.updatedAt)}`}
            </span>
          </span>
        </button>
        <button
          className="icon-btn trip-more"
          title="Trip options"
          aria-label={`Options for ${t.title}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setMenu(open ? null : { tripId: t.id, top: r.bottom + 4, left: r.left });
          }}
        >
          ⋯
        </button>
        {open && (
          <div
            className="menu-list trip-menu"
            role="menu"
            aria-label={`Options for ${t.title}`}
            style={{ top: menu.top, left: menu.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {editable && (
              <button role="menuitem" onClick={() => run(() => onRename(t.id))}>
                Rename…
              </button>
            )}
            {owner && (
              <button role="menuitem" onClick={() => run(() => onShare(t.id))}>
                Share…
              </button>
            )}
            {editable && (
              <button role="menuitem" disabled={!t.hasItinerary} onClick={() => run(() => onSaveVersion(t.id))}>
                Save version…
              </button>
            )}
            {/* Formats open in a submenu on hover, or on click/→ for touch and keyboard. */}
            <div
              className="submenu"
              onMouseEnter={() => {
                keyboardOpen.current = false;
                if (t.hasItinerary) setExportOpen(true);
              }}
              onMouseLeave={() => setExportOpen(false)}
            >
              <button
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                disabled={!t.hasItinerary}
                onClick={(e) => {
                  // Only opens: a tap also fires mouseenter, which already opened it.
                  // detail 0 means Enter/Space rather than a pointer.
                  keyboardOpen.current = e.detail === 0;
                  setExportOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight") return;
                  e.preventDefault();
                  keyboardOpen.current = true;
                  setExportOpen(true);
                }}
              >
                Export as…<span className="submenu-arrow" aria-hidden="true">›</span>
              </button>
              {exportOpen && (
                <div
                  className="menu-list submenu-list"
                  role="menu"
                  aria-label="Export as"
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    setExportOpen(false);
                    (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                  }}
                >
                  {EXPORT_FORMATS.map(([format, label], i) => (
                    <button key={format} role="menuitem" autoFocus={i === 0 && keyboardOpen.current} onClick={() => run(() => onExport(t.id, format))}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {editable && (
              <button role="menuitem" onClick={() => run(() => onComplete(t.id, !t.completedAt))}>
                {t.completedAt ? "Move out of Completed" : "Mark as completed"}
              </button>
            )}
            <hr className="menu-sep" />
            {owner ? (
              <button role="menuitem" className="danger-text" onClick={() => run(() => onDelete(t.id))}>
                Delete trip…
              </button>
            ) : (
              <button role="menuitem" className="danger-text" onClick={() => run(() => onLeave(t.id))}>
                Leave trip…
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  const sorted = sortTrips(trips, sort);
  const upcoming = sorted.filter((t) => !t.completedAt);
  const mine = upcoming.filter((t) => t.role === "owner");
  const shared = upcoming.filter((t) => t.role !== "owner");
  const completed = sorted.filter((t) => t.completedAt);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          <LogoIcon />
        </span>
        <span className="brand-name">PlanAway</span>
        <button className="icon-btn panel-close hide-sidebar" title="Hide trips" aria-label="Hide trips" onClick={onHide}>
          <CloseIcon size={18} />
        </button>
      </div>
      <button className="btn primary block new-trip" onClick={onNewTrip}>
        <PlusIcon />
        New trip
      </button>

      <div className="trip-sections">
        <section>
          <div className="section-head">
            <h2 className="side-heading">Your trips</h2>
            <select className="trip-sort" aria-label="Sort trips" value={sort} onChange={(e) => changeSort(e.target.value as SortOrder)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="departure">Departure date</option>
            </select>
          </div>
          {loading ? (
            <TripListSkeleton />
          ) : (
            <ul className="trip-list">
              {mine.length === 0 && <li className="empty-list">No trips yet.</li>}
              {mine.map(tripItem)}
            </ul>
          )}
        </section>
        {shared.length > 0 && (
          <section>
            <h2 className="side-heading">Shared with you</h2>
            <ul className="trip-list">{shared.map(tripItem)}</ul>
          </section>
        )}
        {completed.length > 0 && (
          <section className="completed-trips">
            <h2 className="side-heading">Completed trips</h2>
            <ul className="trip-list">{completed.map(tripItem)}</ul>
          </section>
        )}
      </div>

      <div className="user-footer">
        <Link className="user-info" href="/settings" title="Settings">
          <Avatar name={user.name} url={user.avatarUrl} />
          <span className="user-name">{user.name}</span>
          <span className="user-settings" aria-hidden="true">
            <GearIcon size={15} />
          </span>
        </Link>
        <button className="link-btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <SiteFooter compact />
    </aside>
  );
}

/** Warm tints for trips with no photo yet, picked by trip id so each keeps its color. */
const THUMB_TINTS = ["#E8C3A8", "#BFD9E6", "#C9DCC4", "#E6CBE0", "#F0D9A8", "#C8CDEB"];

/** The trip's first destination photo, or its initial on a tint. */
function TripThumb({ trip, lookup }: { trip: TripSummary; lookup?: PlaceLookup }) {
  const [broken, setBroken] = useState(false);
  const dest = trip.destinations[0];
  const photo = dest && lookup ? lookup(areaQuery(dest))?.photos[0] : undefined;
  if (photo && !broken) {
    return (
      <span className="t-thumb" title={credit(photo)} aria-hidden="true">
        <img src={photo.thumb} alt="" loading="lazy" onError={() => setBroken(true)} />
      </span>
    );
  }
  const tint = THUMB_TINTS[[...trip.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % THUMB_TINTS.length];
  return (
    <span className="t-thumb initial" style={{ background: tint }} aria-hidden="true">
      {trip.title.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
