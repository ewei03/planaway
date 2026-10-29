import { describe, expect, it } from "vitest";
import { EXPORTS, ExportUnavailable, exportFilename } from "@/lib/export";
import { sampleItinerary } from "../fixtures";

const render = (format: keyof typeof EXPORTS, it = sampleItinerary()) => EXPORTS[format].render(it);

describe("exportFilename", () => {
  it("slugifies the title", () => {
    expect(exportFilename(sampleItinerary(), "csv")).toBe("kyoto-food-weekend.csv");
  });

  it("falls back when the title has no usable characters", () => {
    const it = { ...sampleItinerary(), title: "東京!!" };
    expect(exportFilename(it, "ics")).toBe("itinerary.ics");
  });
});

describe("CSV export", () => {
  const rows = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

  it("starts with a BOM and a header row, using CRLF line endings", () => {
    const csv = render("csv");
    expect(csv.startsWith("﻿Section,Day,Date,")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("has one row per flight, stay, activity, budget line, and the total", () => {
    // 1 header + 1 flight + 1 stay + 3 activities + 2 budget lines + total
    expect(rows(render("csv"))).toHaveLength(9);
  });

  it("quotes cells with commas and quotes", () => {
    const it = sampleItinerary();
    it.days[0].activities[0].description = 'Try "tamago", then mochi';
    expect(render("csv", it)).toContain('"Try ""tamago"", then mochi"');
  });

  it("neutralizes spreadsheet formulas from web content", () => {
    const it = sampleItinerary();
    it.days[0].activities[0].name = "=HYPERLINK(\"http://evil\")";
    it.days[0].activities[1].name = "@SUM(A1)";
    const csv = render("csv", it);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(",'@SUM(A1),");
  });

  it("does not prefix negative numbers", () => {
    const it = sampleItinerary();
    it.budget.breakdown[0].amount = -50;
    expect(render("csv", it)).toContain(",-50,");
  });

  it("omits the total row when there is no estimate", () => {
    const it = sampleItinerary();
    it.budget.estimated_total = null;
    expect(render("csv", it)).not.toContain("Estimated total");
  });
});

describe("Markdown export", () => {
  it("renders the title, sections, and links", () => {
    const md = render("md");
    expect(md).toMatch(/^# Kyoto Food Weekend\n/);
    expect(md).toContain("## Flights");
    expect(md).toContain("[SFO → KIX](https://example.com/flights/sfo-kix)");
    expect(md).toContain("### Day 1 (2027-04-02): Arrival and Nishiki Market");
    expect(md).toContain("**Estimated total:** $4,200");
  });

  it("escapes pipes inside budget table cells", () => {
    expect(render("md")).toContain("Ryokan \\| 3 nights");
  });

  it("skips empty sections", () => {
    const it = sampleItinerary();
    it.flights = [];
    it.lodging = [];
    it.tips = [];
    const md = render("md", it);
    expect(md).not.toContain("## Flights");
    expect(md).not.toContain("## Where to stay");
    expect(md).not.toContain("## Tips");
  });

  it("falls back to plain amounts for an invalid currency code", () => {
    const it = { ...sampleItinerary(), currency: "NOPE" };
    expect(render("md", it)).toContain("4200 NOPE");
  });
});

describe("iCalendar export", () => {
  it("is a valid calendar with an event per dated flight and day", () => {
    const ics = render("ics");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("DTSTART;VALUE=DATE:20270402");
    expect(ics).toContain("DTEND;VALUE=DATE:20270403");
  });

  it("rolls DTEND over month and year boundaries", () => {
    const it = sampleItinerary();
    it.flights = [];
    it.days = [{ ...it.days[0], date: "2026-12-31" }];
    expect(render("ics", it)).toContain("DTEND;VALUE=DATE:20270101");
  });

  it("escapes commas, semicolons, and newlines in text", () => {
    const it = sampleItinerary();
    it.title = "Food; drink, and fun";
    const ics = render("ics", it);
    expect(ics).toContain("X-WR-CALNAME:Food\\; drink\\, and fun");
    expect(ics).toMatch(/DESCRIPTION:Kyoto\\n\\n15:00 Nishiki Market/);
  });

  it("folds lines longer than 75 octets", () => {
    const it = sampleItinerary();
    it.days[0].title = "A very long day title ".repeat(10);
    const lines = render("ics", it).split("\r\n");
    for (const line of lines) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(lines.some((l) => l.startsWith(" "))).toBe(true);
  });

  it("does not split multi-byte characters when folding", () => {
    const it = sampleItinerary();
    it.days[0].title = "京都".repeat(40);
    const ics = render("ics", it);
    expect(ics).not.toContain("�");
    // Unfolding restores the original text.
    expect(ics.replace(/\r\n /g, "")).toContain("京都".repeat(40));
  });

  it("ignores malformed dates", () => {
    const it = sampleItinerary();
    it.flights[0].date = "April 1st";
    expect(render("ics", it).match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("refuses to export when nothing has a date", () => {
    const it = sampleItinerary();
    it.flights.forEach((f) => (f.date = null));
    it.days.forEach((d) => (d.date = null));
    expect(() => render("ics", it)).toThrow(ExportUnavailable);
  });
});

describe("JSON export", () => {
  it("round-trips the itinerary", () => {
    expect(JSON.parse(render("json"))).toEqual(sampleItinerary());
  });
});
