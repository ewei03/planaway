import AIRPORT_ROWS from "./airports.json";

// Type-ahead suggestions for a starting point: an airport, city, or address.
// - Airports come from lib/airports.json (OurAirports, public domain; rebuild
//   with scripts/build-airports.mjs), so codes like "SFO" match. The place
//   search below doesn't know airport codes.
// - Cities, regions, and addresses come from Photon, a free, keyless
//   OpenStreetMap search made for search-as-you-type (photon.komoot.io).
//   Nominatim's usage policy doesn't allow type-ahead, so it isn't used here.

export type SuggestionKind = "airport" | "city" | "region" | "address" | "place";

export interface PlaceSuggestion {
  kind: SuggestionKind;
  /** The main line, e.g. "San Francisco International Airport (SFO)". */
  label: string;
  /** Where it is, e.g. "San Francisco, United States". */
  detail: string;
  /** What's saved as the starting point: the label and detail together, capped to fit. */
  value: string;
}

export const MIN_QUERY = 2;
export const MAX_SUGGESTIONS = 8;
const MAX_AIRPORTS = 3;
const MAX_VALUE = 120;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_SIZE = 500;
const USER_AGENT = "PlanAway/1.0 (collaborative trip planner)";

const photonUrl = () => process.env.PHOTON_URL || "https://photon.komoot.io";

/** [code, name, city, country, size: 0 large, 1 medium, 2 small] */
type AirportRow = [string, string, string, string, number];
const AIRPORTS = AIRPORT_ROWS as AirportRow[];

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Airport rows with their search text folded once, on first use. */
let indexed: { row: AirportRow; city: string; name: string; words: string[] }[] | null = null;
const airportIndex = () =>
  (indexed ??= AIRPORTS.map((row) => ({ row, city: words(row[2]).join(" "), name: words(row[1]).join(" "), words: words(`${row[1]} ${row[2]}`) })));

function suggestion(kind: SuggestionKind, label: string, detail: string): PlaceSuggestion {
  return { kind, label, detail, value: (detail ? `${label}, ${detail}` : label).slice(0, MAX_VALUE) };
}

const airportSuggestion = ([code, name, city, country]: AirportRow) =>
  suggestion("airport", `${name} (${code})`, [city, country].filter(Boolean).join(", "));

/**
 * Airports matching the query: its code exactly ("sfo"), or every word of it
 * starting a word of the airport's name or city ("heathrow", "san fran").
 * Ranked by how well they match, the city the query starts first, then by size.
 */
export function searchAirports(query: string): PlaceSuggestion[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const q = terms.join(" ");
  const byCode = /^[a-z]{3}$/.test(q) ? AIRPORTS.filter(([code]) => code.toLowerCase() === q) : [];
  const rank = (city: string, name: string) => (city.startsWith(q) ? 0 : name.startsWith(q) ? 1 : ` ${name}`.includes(` ${q}`) ? 2 : 3);
  const byName = airportIndex()
    .filter(({ row, words }) => !byCode.includes(row) && terms.every((t) => words.some((w) => w.startsWith(t))))
    .map((a) => ({ row: a.row, rank: rank(a.city, a.name) }))
    // A stable sort, and AIRPORTS is sorted largest first, so size breaks ties.
    .sort((a, b) => a.rank - b.rank)
    .map(({ row }) => row);
  return [...byCode, ...byName].slice(0, MAX_AIRPORTS).map(airportSuggestion);
}

interface PhotonFeature {
  properties: {
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

const KIND_ORDER: Record<SuggestionKind, number> = { city: 0, region: 1, address: 2, place: 3, airport: 4 };

const CITY_VALUES = new Set(["city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter", "locality", "municipality", "borough"]);

function kindOf(p: PhotonFeature["properties"]): SuggestionKind {
  if (p.housenumber || p.osm_key === "highway") return "address";
  if (p.osm_key === "place" && p.osm_value && CITY_VALUES.has(p.osm_value)) return "city";
  if (p.osm_key === "place" || p.osm_key === "boundary") return "region";
  return "place";
}

/** A Photon result as a suggestion, or null for ones without a name. */
export function photonSuggestion({ properties: p }: PhotonFeature): PlaceSuggestion | null {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const label = p.name ?? street;
  if (!label) return null;
  const kind = kindOf(p);
  // A street helps tell addresses apart; for a station or a museum it's noise.
  const parts = [kind === "address" && p.name && street !== p.name ? street : "", p.city ?? p.district ?? p.county, p.state, p.country];
  // Skip parts that repeat the label or each other ("Tokyo, Tokyo, Japan").
  const detail = parts.filter((part, i): part is string => !!part && part !== label && parts.indexOf(part) === i).join(", ");
  return suggestion(kind, label, detail);
}

async function searchPhoton(query: string): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, limit: String(MAX_SUGGESTIONS), lang: "en" });
  const res = await fetch(`${photonUrl()}/api/?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(photonUrl()).host}`);
  const { features = [] } = (await res.json()) as { features?: PhotonFeature[] };
  return (
    features
      // Airports come from the list above, with their codes.
      .filter((f) => f.properties.osm_key !== "aeroway")
      .map(photonSuggestion)
      .filter((s): s is PlaceSuggestion => s !== null)
      // Towns and regions are likelier starting points than a station named after one.
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  );
}

const g = globalThis as typeof globalThis & { __planawaySuggestCache?: Map<string, { at: number; places: PlaceSuggestion[] }> };
const cache = (g.__planawaySuggestCache ??= new Map());

/**
 * Suggestions for a partly typed starting point: matching airports, then
 * places. If the place search is down, airports still come back.
 */
export async function suggestPlaces(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < MIN_QUERY) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const airports = searchAirports(q);
  let places: PlaceSuggestion[] = [];
  let ok = true;
  try {
    places = await searchPhoton(q);
  } catch (err) {
    ok = false;
    console.error(`Place search failed for "${q}":`, (err as Error).message);
  }
  // Airports matching a code come first. Otherwise the best place leads, so
  // "san fran" offers the city before its airports.
  const lead = airports[0]?.label.endsWith(`(${q.toUpperCase()})`) ? airports : [...places.slice(0, 1), ...airports];
  const seen = new Set<string>();
  const result = [...lead, ...places].filter((s) => !seen.has(s.value) && seen.add(s.value)).slice(0, MAX_SUGGESTIONS);

  if (ok) {
    // Oldest out first: a Map keeps insertion order.
    cache.delete(key);
    cache.set(key, { at: Date.now(), places: result });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return result;
}
