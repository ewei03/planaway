import type { CSSProperties, ReactNode } from "react";

// Skeleton screens: grey shapes where content is about to appear, laid out
// like the real thing so nothing jumps when it arrives. Each one is a single
// status for screen readers ("Loading…"); the shapes themselves are hidden.

/** One shimmering shape. */
export function Skel({ w, h = 14, round = false, style }: { w?: number | string; h?: number | string; round?: boolean; style?: CSSProperties }) {
  return <span className={`skel ${round ? "round" : ""}`} style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

function Loading({ label = "Loading…", className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`skeleton ${className ?? ""}`} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** The sidebar's trip rows: thumbnail, title, and "Updated" line. */
export function TripListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Loading label="Loading your trips…" className="trip-list-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-trip" key={i}>
          <Skel w={40} h={40} style={{ borderRadius: 10 }} />
          <span className="skel-lines">
            <Skel w={`${80 - i * 12}%`} h={13} />
            <Skel w="45%" h={10} />
          </span>
        </div>
      ))}
    </Loading>
  );
}

/** The itinerary: cover, title card with stats, then a few section boxes. */
export function ItinerarySkeleton({ label = "Loading the itinerary…", caption }: { label?: string; caption?: string }) {
  return (
    <Loading label={label} className="itinerary-skeleton">
      <Skel h={170} style={{ borderRadius: 16 }} />
      <div className="skel-card">
        <Skel w="30%" h={11} />
        <Skel w="65%" h={26} />
        <Skel w="90%" h={13} />
        <div className="skel-stats">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} h={52} style={{ borderRadius: 12 }} />
          ))}
        </div>
      </div>
      {caption && <p className="skel-caption muted small">{caption}</p>}
      {[0, 1, 2].map((i) => (
        <div className="skel-box" key={i}>
          <Skel w={28} h={28} style={{ borderRadius: 8 }} />
          <Skel w={`${40 - i * 8}%`} h={14} />
        </div>
      ))}
    </Loading>
  );
}

/** A whole trip opening: the chat on one side, the itinerary on the other. */
export function TripSkeleton() {
  return (
    <section className="workspace trip-skeleton">
      <Loading label="Opening trip…" className="chat-skeleton">
        <div className="skel-chat-head">
          <Skel w="55%" h={22} />
        </div>
        <div className="skel-messages">
          <Skel w="60%" h={42} style={{ alignSelf: "flex-end", borderRadius: 16 }} />
          <Skel w="78%" h={86} style={{ borderRadius: 16 }} />
          <Skel w="50%" h={42} style={{ alignSelf: "flex-end", borderRadius: 16 }} />
          <Skel w="70%" h={64} style={{ borderRadius: 16 }} />
        </div>
      </Loading>
      <div className="split-handle" aria-hidden="true" />
      <div className="itinerary-pane">
        <div className="pane-toolbar">
          <Skel w={240} h={40} style={{ borderRadius: 999 }} />
          <Skel w={34} h={34} round />
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Skel w={44} h={40} style={{ borderRadius: 10 }} />
            <Skel w={96} h={40} style={{ borderRadius: 10 }} />
          </span>
        </div>
        <div className="pane-body">
          <div className="itinerary">
            <ItinerarySkeleton label="Opening trip…" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The Share dialog's link controls and member list. */
export function SharingSkeleton() {
  return (
    <Loading label="Loading sharing…" className="dialog-body sharing-skeleton">
      <Skel w="28%" h={11} />
      <div className="skel-row">
        <Skel w={110} h={40} style={{ borderRadius: 10 }} />
        <Skel w={140} h={40} style={{ borderRadius: 10 }} />
        <Skel w={110} h={40} style={{ borderRadius: 10 }} />
      </div>
      <Skel w="90%" h={11} />
      <Skel w="36%" h={11} style={{ marginTop: 16 }} />
      {[0, 1].map((i) => (
        <div className="skel-row" key={i}>
          <Skel w={32} h={32} round />
          <Skel w="40%" h={13} />
        </div>
      ))}
    </Loading>
  );
}

/** The Settings page: heading and a few section cards. */
export function SettingsSkeleton() {
  return (
    <div className="settings-page">
      <Loading label="Loading settings…" className="settings-inner">
        <Skel w={110} h={14} />
        <Skel w={200} h={40} />
        {[220, 180, 260].map((h, i) => (
          <div className="card settings-section skel-section" key={i} style={{ height: h }}>
            <Skel w="30%" h={22} />
            <Skel w="100%" h={40} style={{ borderRadius: 10 }} />
            <Skel w="100%" h={40} style={{ borderRadius: 10 }} />
          </div>
        ))}
      </Loading>
    </div>
  );
}
