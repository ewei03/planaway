// Builds lib/airports.json, the airports the Starting point search finds by
// code ("SFO"), from OurAirports' public-domain data:
// https://ourairports.com/data/
//
//   node scripts/build-airports.mjs
//
// Keeps airports with an IATA code and scheduled passenger service.

import { writeFileSync } from "node:fs";

const SOURCE = "https://davidmegginson.github.io/ourairports-data";
const SIZES = { large_airport: 0, medium_airport: 1, small_airport: 2 };

/** Rows of a CSV file as objects keyed by the header row. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const get = async (file) => {
  const res = await fetch(`${SOURCE}/${file}`);
  if (!res.ok) throw new Error(`${res.status} fetching ${file}`);
  return parseCsv(await res.text());
};

const countries = new Map((await get("countries.csv")).map((c) => [c.code, c.name]));
const airports = (await get("airports.csv"))
  .filter((a) => /^[A-Z]{3}$/.test(a.iata_code) && a.scheduled_service === "yes" && a.type in SIZES)
  .map((a) => [a.iata_code, a.name, a.municipality, countries.get(a.iso_country) ?? a.iso_country, SIZES[a.type]])
  .sort((a, b) => a[4] - b[4] || (a[0] < b[0] ? -1 : 1));

// One per code: the largest wins when a code is listed twice.
const seen = new Set();
const unique = airports.filter(([code]) => !seen.has(code) && seen.add(code));

writeFileSync(new URL("../lib/airports.json", import.meta.url), JSON.stringify(unique) + "\n");
console.log(`Wrote ${unique.length} airports to lib/airports.json`);
