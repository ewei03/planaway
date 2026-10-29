import type { Itinerary } from "./itinerary";

export type ExportFormat = "csv" | "md" | "ics" | "json";

export const EXPORTS: Record<ExportFormat, { ext: string; mime: string; render: (it: Itinerary) => string }> = {
  csv: { ext: "csv", mime: "text/csv; charset=utf-8", render: toCsv },
  md: { ext: "md", mime: "text/markdown; charset=utf-8", render: toMarkdown },
  ics: { ext: "ics", mime: "text/calendar; charset=utf-8", render: toIcs },
  json: { ext: "json", mime: "application/json; charset=utf-8", render: (it) => JSON.stringify(it, null, 2) },
};

export function exportFilename(it: Itinerary, format: ExportFormat): string {
  const slug = it.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "itinerary";
  return `${slug}.${EXPORTS[format].ext}`;
}

// --- CSV: one flat table so it opens cleanly in Excel / Google Sheets ---

const CSV_COLUMNS = ["Section", "Day", "Date", "Time", "Location", "Item", "Category", "Details", "Est. cost", "Currency", "URL"];

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Text from the web could start with a spreadsheet formula character.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(it: Itinerary): string {
  const rows: (string | number | null)[][] = [];
  for (const f of it.flights) {
    rows.push(["Flight", null, f.date, null, `${f.from} → ${f.to}`, f.carrier ?? "Flight", "transport", f.notes, f.est_price, it.currency, f.booking_url]);
  }
  for (const l of it.lodging) {
    const dates = [l.check_in, l.check_out].filter(Boolean).join(" to ");
    const details = [dates && `Stay ${dates}`, l.nightly_price !== null && `${l.nightly_price}/night`, l.notes].filter(Boolean).join("; ");
    rows.push(["Lodging", null, l.check_in, null, l.area, l.name, "lodging", details, null, it.currency, l.booking_url]);
  }
  for (const d of it.days) {
    for (const a of d.activities) {
      rows.push(["Itinerary", d.day, d.date, a.time, d.location, a.name, a.category, a.description, a.est_cost, it.currency, a.url]);
    }
  }
  for (const b of it.budget.breakdown) {
    rows.push(["Budget", null, null, null, null, b.category, null, b.notes, b.amount, it.currency, null]);
  }
  if (it.budget.estimated_total !== null) {
    rows.push(["Budget", null, null, null, null, "Estimated total", null, it.budget.notes, it.budget.estimated_total, it.currency, null]);
  }
  // BOM so Excel detects UTF-8 (accents, arrows, currency symbols).
  return "\uFEFF" + [CSV_COLUMNS, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// --- Markdown: readable, shareable document ---

function money(amount: number | null, currency: string): string {
  if (amount === null) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function link(text: string, url: string | null): string {
  return url ? `[${text}](${url})` : text;
}

function toMarkdown(it: Itinerary): string {
  const out: string[] = [`# ${it.title}`, "", it.summary, ""];
  const facts = [
    it.origin && `**From:** ${it.origin}`,
    it.destinations.length > 0 && `**Destinations:** ${it.destinations.join(", ")}`,
    (it.start_date || it.end_date) && `**Dates:** ${it.start_date ?? "?"} to ${it.end_date ?? "?"}`,
    `**Travelers:** ${it.travelers}`,
    it.budget.estimated_total !== null && `**Estimated total:** ${money(it.budget.estimated_total, it.currency)}`,
  ].filter(Boolean);
  out.push(...facts.map((f) => `- ${f}`), "");

  if (it.flights.length > 0) {
    out.push("## Flights", "");
    for (const f of it.flights) {
      const bits = [f.date, f.carrier, money(f.est_price, it.currency), f.notes].filter(Boolean).join(" · ");
      out.push(`- ${link(`${f.from} → ${f.to}`, f.booking_url)}${bits ? ` — ${bits}` : ""}`);
    }
    out.push("");
  }
  if (it.lodging.length > 0) {
    out.push("## Where to stay", "");
    for (const l of it.lodging) {
      const dates = l.check_in || l.check_out ? `${l.check_in ?? "?"} to ${l.check_out ?? "?"}` : "";
      const price = l.nightly_price !== null ? `${money(l.nightly_price, it.currency)}/night` : "";
      const bits = [l.area, dates, price, l.notes].filter(Boolean).join(" · ");
      out.push(`- ${link(l.name, l.booking_url)} — ${bits}`);
    }
    out.push("");
  }
  out.push("## Day by day", "");
  for (const d of it.days) {
    out.push(`### Day ${d.day}${d.date ? ` (${d.date})` : ""}: ${d.title}`, `*${d.location}*`, "");
    for (const a of d.activities) {
      const cost = a.est_cost !== null ? ` (${money(a.est_cost, it.currency)})` : "";
      out.push(`- ${a.time ? `**${a.time}** ` : ""}${link(a.name, a.url)}${cost} — ${a.description}`);
    }
    out.push("");
  }
  if (it.budget.breakdown.length > 0) {
    out.push("## Budget", "", "| Category | Amount | Notes |", "| --- | ---: | --- |");
    for (const b of it.budget.breakdown) {
      out.push(`| ${b.category} | ${money(b.amount, it.currency)} | ${(b.notes ?? "").replace(/\|/g, "\\|")} |`);
    }
    if (it.budget.estimated_total !== null) out.push(`| **Total** | **${money(it.budget.estimated_total, it.currency)}** | |`);
    if (it.budget.notes) out.push("", it.budget.notes);
    out.push("");
  }
  if (it.tips.length > 0) out.push("## Tips", "", ...it.tips.map((t) => `- ${t}`), "");
  if (it.sources.length > 0) out.push("## Sources", "", ...it.sources.map((s) => `- [${s.title}](${s.url})`), "");
  out.push("*Prices are estimates gathered from the web and will change; confirm before booking.*", "");
  return out.join("\n");
}

// --- iCalendar: one all-day event per day, plus flights. Needs real dates. ---

function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// RFC 5545: lines longer than 75 octets are folded with CRLF + space.
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > 74) {
      parts.push(current);
      current = " ";
    }
    current += ch;
  }
  parts.push(current);
  return parts.join("\r\n");
}

function icsDate(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replace(/-/g, "") : null;
}

function nextDay(ymd: string): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + 1));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export class ExportUnavailable extends Error {}

function toIcs(it: Itinerary): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const events: { date: string; summary: string; description: string; url: string | null }[] = [];

  for (const f of it.flights) {
    const date = f.date && icsDate(f.date);
    if (!date) continue;
    events.push({
      date,
      summary: `Flight ${f.from} → ${f.to}${f.carrier ? ` (${f.carrier})` : ""}`,
      description: f.notes ?? "",
      url: f.booking_url,
    });
  }
  for (const d of it.days) {
    const date = d.date && icsDate(d.date);
    if (!date) continue;
    const lines = d.activities.map((a) => `${a.time ? `${a.time} ` : ""}${a.name}: ${a.description}`);
    events.push({ date, summary: `${it.title}: Day ${d.day}, ${d.title}`, description: `${d.location}\n\n${lines.join("\n")}`, url: null });
  }
  if (events.length === 0) {
    throw new ExportUnavailable("This itinerary has no dates yet. Ask the agent to set travel dates, then export the calendar.");
  }

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PlanAway//Trip Planner//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(it.title)}`];
  events.forEach((e, i) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${stamp}-${i}@planaway`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.date}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${icsText(e.summary)}`,
      `DESCRIPTION:${icsText(e.description)}`,
      ...(e.url ? [`URL:${e.url}`] : []),
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
