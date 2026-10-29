import type { Itinerary } from "./itinerary";

// Turns an itinerary into places to look up, and the looked-up places into a
// route to draw on the map. Pure and shared by server and browser; nothing
// here talks to a map service. The map component only consumes `Route`.

/** A freely licensed photo from Wikimedia Commons. */
export interface PlacePhoto {
  /** About 1280px wide. */
  src: string;
  /** About 330px wide, for thumbnails. */
  thumb: string;
  author: string | null;
  /** Short license name, e.g. "CC BY-SA 4.0". */
  license: string | null;
  /** The photo's Commons page, with full license details. */
  sourceUrl: string | null;
}

export interface Place {
  /** OpenStreetMap element, e.g. "node/123". */
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** The place on openstreetmap.org. */
  mapsUrl: string | null;
  photos: PlacePhoto[];
}

/** Returns the place for a query: null if nothing was found, undefined if not looked up yet. */
export type PlaceLookup = (query: string) => Place | null | undefined;

type Day = Itinerary["days"][number];
type Activity = Day["activities"][number];
type Lodging = Itinerary["lodging"][number];

/** Cache key for a query: case and spacing don't matter. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

// Getting from A to B, or downtime, isn't a place on the map.
const UNMAPPED = new Set<Activity["category"]>(["transport", "rest"]);

export function activityQuery(a: Activity, day: Day): string | null {
  return UNMAPPED.has(a.category) ? null : `${a.name}, ${day.location}`;
}

export const lodgingQuery = (l: Lodging) => `${l.name}, ${l.area}`;
/**
 * A city, region, or country (destinations, where each day is). Marked so the
 * search looks only for places people live: a bare "Nara" otherwise finds the
 * US National Archives.
 */
export const AREA_PREFIX = "area:";
export const areaQuery = (name: string) => `${AREA_PREFIX}${name.trim()}`;
export const airportQuery = (code: string) => (/airport/i.test(code) ? code : `${code} airport`);

/** Everything in the itinerary worth a photo or a pin, deduplicated. */
export function placeQueries(it: Itinerary): string[] {
  const queries = [
    ...it.destinations.map(areaQuery),
    ...it.days.map((d) => areaQuery(d.location)),
    ...it.lodging.map(lodgingQuery),
    ...it.days.flatMap((d) => d.activities.map((a) => activityQuery(a, d))),
    ...it.flights.flatMap((f) => [airportQuery(f.from), airportQuery(f.to)]),
  ];
  const seen = new Map<string, string>();
  for (const q of queries) {
    if (q && q.replace(AREA_PREFIX, "").trim() && !seen.has(normalizeQuery(q))) seen.set(normalizeQuery(q), q.trim());
  }
  return [...seen.values()];
}

// ---------- Route ----------

export interface Stop {
  /** Matches the itinerary item's id. */
  id: string;
  kind: "activity" | "lodging" | "airport";
  label: string;
  detail: string | null;
  place: Place;
  /** Day number for activities. */
  day: number | null;
  /** 1-based position within the day, for activities. */
  order: number | null;
}

export interface DayRoute {
  day: number;
  title: string;
  date: string | null;
  /** Where the day starts and ends, when the itinerary says where you're staying that night. */
  lodging: Stop | null;
  stops: Stop[];
}

export interface FlightRoute {
  id: string;
  label: string;
  from: Stop;
  to: Stop;
}

export interface Route {
  days: DayRoute[];
  flights: FlightRoute[];
  lodging: Stop[];
  /** Every mapped point, for fitting the map's bounds. */
  points: { lat: number; lng: number }[];
}

/** The stay whose check-in to check-out covers the day's date. */
function lodgingFor(day: Day, it: Itinerary): Lodging | null {
  if (day.date) {
    const match = it.lodging.find((l) => l.check_in && l.check_out && l.check_in <= day.date! && day.date! < l.check_out);
    if (match) return match;
  }
  // Undated trips with one stay: that's where every night is.
  const undated = it.days.every((d) => !d.date);
  return undated && it.lodging.length === 1 ? it.lodging[0] : null;
}

export function buildRoute(it: Itinerary, lookup: PlaceLookup): Route {
  const lodging: Stop[] = [];
  const lodgingStops = new Map<string, Stop>();
  for (const l of it.lodging) {
    const place = lookup(lodgingQuery(l));
    if (!place) continue;
    const stop: Stop = { id: l.id, kind: "lodging", label: l.name, detail: l.area, place, day: null, order: null };
    lodging.push(stop);
    lodgingStops.set(l.id, stop);
  }

  const days: DayRoute[] = it.days.map((d) => {
    const stops: Stop[] = [];
    for (const a of d.activities) {
      const q = activityQuery(a, d);
      const place = q ? lookup(q) : null;
      if (!place) continue;
      stops.push({ id: a.id, kind: "activity", label: a.name, detail: a.time, place, day: d.day, order: stops.length + 1 });
    }
    const stay = lodgingFor(d, it);
    return { day: d.day, title: d.title, date: d.date, lodging: stay ? (lodgingStops.get(stay.id) ?? null) : null, stops };
  });

  const flights: FlightRoute[] = [];
  for (const f of it.flights) {
    const from = lookup(airportQuery(f.from));
    const to = lookup(airportQuery(f.to));
    if (!from || !to) continue;
    const label = `${f.from} → ${f.to}`;
    flights.push({
      id: f.id,
      label,
      from: { id: `${f.id}:from`, kind: "airport", label: f.from, detail: label, place: from, day: null, order: null },
      to: { id: `${f.id}:to`, kind: "airport", label: f.to, detail: label, place: to, day: null, order: null },
    });
  }

  const points = [
    ...lodging,
    ...days.flatMap((d) => d.stops),
    ...flights.flatMap((f) => [f.from, f.to]),
  ].map((s) => ({ lat: s.place.lat, lng: s.place.lng }));

  return { days, flights, lodging, points };
}

// ---------- Geometry ----------

type LatLng = { lat: number; lng: number };

/** Shifts a longitude by whole turns so it lies within 180° of `ref`. */
export function unwrapLng(lng: number, ref: number): number {
  return lng + 360 * Math.round((ref - lng) / 360);
}

/**
 * Points along the shortest path over the globe, so long flights curve the
 * way planes fly. Longitudes are continuous (they may pass ±180) so the line
 * doesn't jump across the map at the antimeridian.
 */
export function greatCircle(a: LatLng, b: LatLng, segments = 64): LatLng[] {
  const rad = Math.PI / 180;
  const [φ1, λ1, φ2, λ2] = [a.lat * rad, a.lng * rad, b.lat * rad, b.lng * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d < 1e-9) return [a, { lat: b.lat, lng: unwrapLng(b.lng, a.lng) }];
  const points: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const lng = Math.atan2(y, x) / rad;
    const prev = points.at(-1)?.lng ?? a.lng;
    points.push({ lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / rad, lng: unwrapLng(lng, prev) });
  }
  return points;
}

/** The ordered path for one day: from that night's stay, through the stops, and back. */
export function dayPath(day: DayRoute): { lat: number; lng: number }[] {
  const stops = day.lodging ? [day.lodging, ...day.stops, day.lodging] : day.stops;
  return stops.map((s) => ({ lat: s.place.lat, lng: s.place.lng }));
}

/** Photos for the trip's header: the first photo of each destination. */
export function heroPhotos(it: Itinerary, lookup: PlaceLookup): { place: Place; photo: PlacePhoto; label: string }[] {
  const out: { place: Place; photo: PlacePhoto; label: string }[] = [];
  for (const dest of it.destinations) {
    const place = lookup(areaQuery(dest));
    if (place?.photos[0] && !out.some((o) => o.place.id === place.id)) out.push({ place, photo: place.photos[0], label: dest });
  }
  return out;
}
