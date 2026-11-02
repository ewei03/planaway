"use client";

import { useEffect, useRef, useState } from "react";
import { canEdit, EXPORT_FORMATS, relativeTime, useMinuteTick, type ExportFormat, type SessionUser, type TripSummary } from "./client";
import { SiteFooter } from "./SiteFooter";

type SortOrder = "newest" | "oldest";
const SORT_KEY = "planaway:trip-sort";

interface Props {
  user: SessionUser;
  /** The user's own trips and the ones shared with them, newest activity first. */
  trips: TripSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewTrip: () => void;
  onRename: (tripId: string) => void;
  onSaveVersion: (tripId: string) => void;
  onExport: (tripId: string, format: ExportFormat) => void;
  onShare: (tripId: string) => void;
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
  const { user, trips, activeId, onSelect, onNewTrip, onSignOut, onHide } = props;
  const { onRename, onSaveVersion, onExport, onShare, onDelete, onLeave } = props;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  useMinuteTick();

  // Remember the sort order across visits. Read after mount so the
  // server-rendered markup matches the first client render.
  useEffect(() => {
    try {
      if (localStorage.getItem(SORT_KEY) === "oldest") setSort("oldest");
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
          <span className="t-title">{t.title}</span>
          <span className="t-meta">Updated {relativeTime(t.updatedAt)}</span>
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

  const sign = sort === "newest" ? -1 : 1;
  const sorted = [...trips].sort((a, b) => sign * (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)));
  const mine = sorted.filter((t) => t.role === "owner");
  const shared = sorted.filter((t) => t.role !== "owner");

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          ✈
        </span>
        <span>PlanAway</span>
        <button className="icon-btn hide-sidebar" title="Hide trips" aria-label="Hide trips" onClick={onHide}>
          ✕
        </button>
      </div>
      <button className="btn primary block" onClick={onNewTrip}>
        + New trip
      </button>

      <div className="trip-sections">
        <section>
          <div className="section-head">
            <h2 className="side-heading">Your trips</h2>
            <select className="trip-sort" aria-label="Sort trips" value={sort} onChange={(e) => changeSort(e.target.value as SortOrder)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <ul className="trip-list">
            {mine.length === 0 && <li className="empty-list">No trips yet.</li>}
            {mine.map(tripItem)}
          </ul>
        </section>
        {shared.length > 0 && (
          <section>
            <h2 className="side-heading">Shared with you</h2>
            <ul className="trip-list">{shared.map(tripItem)}</ul>
          </section>
        )}
      </div>

      <div className="user-footer">
        <div className="user-info">
          <span className="avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="user-name" title={user.email}>
            {user.name}
          </span>
        </div>
        <button className="link-btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <SiteFooter compact />
    </aside>
  );
}
