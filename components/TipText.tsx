import type { ReactNode } from "react";

// Subtle emphasis for itinerary tips. The agent marks each tip's key phrase
// with **double asterisks**; on top of that, prices, times, and durations get
// a soft highlight, so tips from before the agent marked them still scan well.
// Builds React elements, never HTML strings.

const KEY = /\*\*([^*]+)\*\*/g;

const CURRENCY = "[$€£¥₩₹]|US\\$|A\\$|C\\$";
const UNIT = "min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|nights?|weeks?|km|mi(?:les?)?";
// 1,500 or 3.40, but not the full stop after "€25."
const AMOUNT = "\\d[\\d,]*(?:\\.\\d+)?";
const FIGURE = new RegExp(
  [
    // ¥1,500 · $20–30 · €15
    `(?:${CURRENCY})\\s?${AMOUNT}(?:\\s?[-–]\\s?${AMOUNT})?`,
    // 1,500 yen · 20 USD
    `${AMOUNT}\\s?(?:yen|euros?|dollars?|USD|EUR|JPY|GBP)\\b`,
    // 7am · 7:30 pm · 18:00
    `\\b\\d{1,2}(?::\\d{2})?\\s?(?:[ap]\\.?m\\.?)(?![a-z])`,
    `\\b\\d{1,2}:\\d{2}\\b`,
    // 30 minutes · 2–3 hours · 3 days
    `\\b\\d+(?:\\s?[-–]\\s?\\d+)?\\s?(?:${UNIT})\\b`,
  ].join("|"),
  "gi",
);

function figures(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(FIGURE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${keyPrefix}-${m.index}`} className="tip-figure">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function TipText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(KEY)) {
    if (m.index > last) out.push(...figures(text.slice(last, m.index), `t${last}`));
    out.push(
      <strong key={`k${m.index}`} className="tip-key">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...figures(text.slice(last), `t${last}`));
  return <>{out}</>;
}
