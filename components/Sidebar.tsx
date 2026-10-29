"use client";

import { canEdit, formatDate, type GroupSummary, type SessionUser } from "./client";

interface Props {
  user: SessionUser;
  groups: GroupSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewTrip: (groupId: string) => void;
  onNewGroup: () => void;
  onManageGroup: (groupId: string) => void;
  onSignOut: () => void;
  onHide: () => void;
}

export function Sidebar({ user, groups, activeId, onSelect, onNewTrip, onNewGroup, onManageGroup, onSignOut, onHide }: Props) {
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
                <button className="icon-btn" title="Members and invites" aria-label={`Manage ${g.name}`} onClick={() => onManageGroup(g.id)}>
                  ⚙
                </button>
              )}
            </div>
            <ul className="trip-list">
              {g.trips.length === 0 && <li className="empty-list">No trips yet.</li>}
              {g.trips.map((t) => (
                <li key={t.id}>
                  <button className={t.id === activeId ? "active" : ""} onClick={() => onSelect(t.id)}>
                    <span className="t-title">{t.title}</span>
                    <span className="t-meta">{t.destinations.slice(0, 3).join(", ") || `Updated ${formatDate(t.updatedAt)}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
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
