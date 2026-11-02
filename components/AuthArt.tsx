/**
 * The illustrated side of the sign-in page: a drawn mountain landscape with a
 * one-line pitch. Drawn rather than a photo so the page needs no lookups
 * before anyone has signed in.
 */
export function AuthArt() {
  return (
    <aside className="auth-art">
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="400" height="260" fill="#D3E3EA" />
        <circle cx="318" cy="56" r="20" fill="#F6EFDF" />
        <path d="M30 190 L120 60 L160 120 L210 40 L280 150 L330 100 L390 190Z" fill="#56677A" />
        <path d="M120 60 L104 84 L118 80 L126 90 L136 82Z M210 40 L194 64 L208 60 L216 70 L228 62Z M330 100 L318 116 L330 114 L338 122 L346 116Z" fill="#FFFFFF" />
        <path d="M0 190 H400 V215 H0Z" fill="#7FAABD" />
        <path d="M0 212 Q100 200 220 214 T400 210 V260 H0Z" fill="#45523F" />
      </svg>
      <div className="auth-pitch">
        <p className="auth-pitch-title">Plan the trip together, not in a group chat.</p>
        <p>Describe where you want to go. PlanAway researches it and builds the itinerary; your friends comment and refine it with you.</p>
      </div>
    </aside>
  );
}
