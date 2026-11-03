import type { ReactNode } from "react";

/**
 * The illustrated side of the sign-in page: a drawn mountain landscape with a
 * one-line pitch. Drawn rather than a photo so the page needs no lookups
 * before anyone has signed in.
 *
 * The landscape pans left forever, like a slow camera move. Each moving layer
 * is a 400×260 tile repeated side by side; farther layers move slower. To
 * redraw a layer, keep its tile seamless: whatever touches the left edge must
 * meet the right edge at the same height and angle, so the copies join up
 * (draw in a 400×260 artboard and check by placing two copies side by side).
 */
export function AuthArt() {
  return (
    <aside className="auth-art">
      {/* Sky and sun stay put, as they would in a real pan. */}
      <svg className="auth-sky" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="400" height="260" fill="#D3E3EA" />
        <circle cx="318" cy="56" r="20" fill="#F6EFDF" />
      </svg>
      <PanLayer className="pan-clouds">
        <g fill="#FFFFFF" opacity="0.75">
          <ellipse cx="70" cy="70" rx="34" ry="9" />
          <ellipse cx="88" cy="63" rx="20" ry="9" />
          <ellipse cx="250" cy="108" rx="26" ry="7" />
          <ellipse cx="262" cy="102" rx="14" ry="7" />
        </g>
      </PanLayer>
      <PanLayer className="pan-far">
        <path d="M0 190 L36 156 L70 172 L128 122 L176 166 L236 132 L290 170 L344 140 L400 190Z" fill="#8FA3B3" />
      </PanLayer>
      <PanLayer className="pan-mountains">
        <path d="M30 190 L120 60 L160 120 L210 40 L280 150 L330 100 L390 190Z" fill="#56677A" />
        <path
          d="M120 60 L104 84 L118 80 L126 90 L136 82Z M210 40 L194 64 L208 60 L216 70 L228 62Z M330 100 L318 116 L330 114 L338 122 L346 116Z"
          fill="#FFFFFF"
        />
      </PanLayer>
      <PanLayer className="pan-ground">
        {/* A pixel past each edge, so neighboring copies overlap and no hairline shows where they meet. */}
        <path d="M-1 190 H401 V215 H-1Z" fill="#7FAABD" />
        {/* The hill line leaves the right edge at the height and angle it enters the left (slope -0.2), so it flows on. */}
        <path d="M-1 212.2 L0 212 C60 200 140 200 200 212 S340 224 400 212 L401 211.8 V260 H-1Z" fill="#45523F" />
      </PanLayer>
      <div className="auth-pitch">
        <p className="auth-pitch-title">Plan your next trip within minutes.</p>
        <p>Describe where you want to go. PlanAway researches it and builds the itinerary.</p>
      </div>
    </aside>
  );
}

/** Enough copies to cover the panel while the strip slides one tile's width. */
const COPIES = 4;

/** One moving layer: copies of a seamless tile in a row, slid left by one tile and repeated. */
function PanLayer({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={`pan-layer ${className}`} aria-hidden="true">
      {Array.from({ length: COPIES }, (_, i) => (
        <svg key={i} viewBox="0 0 400 260" preserveAspectRatio="none">
          {children}
        </svg>
      ))}
    </div>
  );
}
