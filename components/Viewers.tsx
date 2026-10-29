import type { UserRef } from "./client";

const MAX_SHOWN = 3;

/** A stable color per person, so the same collaborator always looks the same. */
function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Overlapping initials for the other people looking at this trip right now. */
export function Viewers({ viewers }: { viewers: UserRef[] }) {
  if (viewers.length === 0) return null;
  const shown = viewers.slice(0, MAX_SHOWN);
  const hidden = viewers.slice(MAX_SHOWN);
  const names = viewers.map((v) => v.name).join(", ");
  return (
    <div className="viewers" role="group" aria-label={`Also viewing: ${names}`}>
      {shown.map((v) => (
        <span key={v.id} className="viewer" title={`${v.name} is viewing`} style={{ background: `hsl(${hue(v.id)} 50% 42%)` }}>
          {v.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="viewer more" title={hidden.map((v) => v.name).join(", ")}>
          +{hidden.length}
        </span>
      )}
    </div>
  );
}
