import type { UserRef } from "./client";

/**
 * Circles shown before the rest collapse into +N, counting you, by pane width.
 * Each tier's cut-off is rendered; container queries in globals.css pick one.
 */
const TIERS = [
  { max: 4, name: "wide" },
  { max: 2, name: "narrow" },
  { max: 1, name: "phone" },
] as const;

/** A stable color per person, so the same collaborator always looks the same. */
function hue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * Overlapping initials for everyone looking at this trip right now: you first,
 * then the others, then a +N circle for whoever doesn't fit.
 */
export function Viewers({ me, viewers }: { me: UserRef; viewers: UserRef[] }) {
  const everyone = [{ ...me, you: true }, ...viewers.filter((v) => v.id !== me.id).map((v) => ({ ...v, you: false }))];
  const names = everyone.map((v) => (v.you ? "You" : v.name)).join(", ");
  // A circle is hidden in every tier whose cut-off it's past.
  const hiddenIn = (i: number) =>
    TIERS.filter((t) => i >= t.max)
      .map((t) => `hide-${t.name}`)
      .join(" ");
  return (
    <div className="viewers" role="group" aria-label={`Viewing now: ${names}`}>
      {everyone.slice(0, TIERS[0].max).map((v, i) => (
        <span
          key={v.id}
          className={`viewer ${v.you ? "you" : ""} ${hiddenIn(i)}`}
          title={v.you ? `You (${v.name})` : `${v.name} is viewing`}
          style={{ background: `hsl(${hue(v.id)} 50% 42%)` }}
        >
          {v.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {TIERS.map(({ max, name }) => {
        const hidden = everyone.slice(max);
        return (
          hidden.length > 0 && (
            <span key={name} className={`viewer more more-${name}`} title={hidden.map((v) => v.name).join(", ")}>
              +{hidden.length}
            </span>
          )
        );
      })}
    </div>
  );
}
