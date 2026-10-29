"use client";

import { useEffect, useRef, useState } from "react";
import {
  canEdit,
  EXPORT_FORMATS,
  formatDate,
  type ExportFormat,
  type GroupSummary,
  type SessionUser,
  type SharedTripSummary,
} from "./client";

type TripSummary = GroupSummary["trips"][number];

interface Props {
  user: SessionUser;
  groups: GroupSummary[];
  /** Trips shared with the user through invite links, outside their groups. */
  shared: SharedTripSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewTrip: (groupId: string) => void;
  onNewGroup: () => void;
  onManageGroup: (groupId: string) => void;
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
  const { user, groups, shared, activeId, onSelect, onNewTrip, onNewGroup, onManageGroup, onSignOut, onHide } = props;
  const { onSaveVersion, onExport, onShare, onDelete, onLeave } = props;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
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

  /** One trip row and its ⋯ menu. `editable`: the user can plan with the agent. */
  const tripItem = (t: TripSummary, editable: boolean, meta: string, sharedWithMe = false) => {
    const open = menu?.tripId === t.id;
    return (
      <li key={t.id} className={`trip-item ${t.id === activeId ? "active" : ""} ${open ? "menu-open" : ""}`}>
        <button className={`trip-open ${t.id === activeId ? "active" : ""}`} onClick={() => onSelect(t.id)}>
          <span className="t-title">{t.title}</span>
          <span className="t-meta">{meta}</span>
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
            {t.canShare && (
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
            {(t.canDelete || sharedWithMe) && <hr className="menu-sep" />}
            {t.canDelete && (
              <button role="menuitem" className="danger-text" onClick={() => run(() => onDelete(t.id))}>
                Delete trip…
              </button>
            )}
            {sharedWithMe && (
              <button role="menuitem" className="danger-text" onClick={() => run(() => onLeave(t.id))}>
                Leave trip…
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  const meta = (t: TripSummary) => t.destinations.slice(0, 3).join(", ") || `Updated ${formatDate(t.updatedAt)}`;

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
      <button className="btn primary block" onClick={() => groups[0] && onNewTrip(groups[0].id)}>
        + New trip
      </button>

      <div className="groups">
        {groups.map((g) => (
          <section className="group" key={g.id}>
            <div className="group-head">
              <h2 className="side-heading">
                {g.personal ? "Personal" : g.name}
                {!g.personal && <span className="member-count"> · {g.memberCount}</span>}
              </h2>
              {!g.personal && canEdit(g.role) && (
                <button className="icon-btn" title={`New trip in ${g.name}`} aria-label={`New trip in ${g.name}`} onClick={() => onNewTrip(g.id)}>
                  +
                </button>
              )}
              {!g.personal && (
                <button className="icon-btn" title="Group members" aria-label={`Manage ${g.name}`} onClick={() => onManageGroup(g.id)}>
                  ⚙
                </button>
              )}
            </div>
            <ul className="trip-list">
              {g.trips.length === 0 && <li className="empty-list">No trips yet.</li>}
              {g.trips.map((t) => tripItem(t, canEdit(g.role), meta(t)))}
            </ul>
          </section>
        ))}
        {shared.length > 0 && (
          <section className="group">
            <div className="group-head">
              <h2 className="side-heading">Shared with you</h2>
            </div>
            <ul className="trip-list">{shared.map((t) => tripItem(t, canEdit(t.role), `From ${t.sharedBy}`, true))}</ul>
          </section>
        )}
        <button className="btn ghost block new-group" onClick={onNewGroup}>
          + New group
        </button>
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
    </aside>
  );
}
