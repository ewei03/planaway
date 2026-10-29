import { and, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema as s } from "./db";
import { AREA_PREFIX, normalizeQuery, type Place, type PlacePhoto } from "./route";

// Free, keyless place data for the map and photos:
// - Nominatim (OpenStreetMap search) finds each place's location, including
//   airports by code ("SFO airport").
// - Wikidata and Wikimedia Commons supply a freely licensed photo, when the
//   OpenStreetMap entry links to Wikidata.
// The public Nominatim server allows one request per second for the whole
// app, so lookups are throttled, cached for 30 days in place_cache, and done a
// few at a time: the browser asks again for whatever is still missing.

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** New lookups per request (about a second each); cached places are always returned. */
export const MAX_NEW_LOOKUPS = 6;
/** Most queries one request may ask about. */
export const MAX_QUERIES = 80;
const USER_AGENT = "PlanAway/1.0 (collaborative trip planner)";

// Overridable to self-host, or to point tests at a stand-in.
const env = (name: string, fallback: string) => process.env[name] || fallback;
const nominatimUrl = () => env("NOMINATIM_URL", "https://nominatim.openstreetmap.org");
const wikidataUrl = () => env("WIKIDATA_URL", "https://www.wikidata.org");
const commonsUrl = () => env("COMMONS_URL", "https://commons.wikimedia.org");

// ---------- Throttle ----------

const g = globalThis as typeof globalThis & { __planawayNominatimNext?: number };

/** Waits for this process's next Nominatim slot, keeping requests a second apart. */
async function nominatimTurn(): Promise<void> {
  const interval = Number(process.env.NOMINATIM_INTERVAL_MS ?? 1100);
  const now = Date.now();
  const slot = Math.max(now, g.__planawayNominatimNext ?? 0);
  g.__planawayNominatimNext = slot + interval;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

// ---------- Places ----------

interface NominatimResult {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  extratags?: Record<string, string> | null;
}

const osmUrl = (type: string, id: number) => `https://www.openstreetmap.org/${type}/${id}`;

/** The best match for a query, or null. `featureType` narrows it, e.g. to towns and cities. */
async function searchNominatim(query: string, featureType?: string): Promise<{ place: Place; wikidata: string | null } | null> {
  await nominatimTurn();
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", extratags: "1", "accept-language": "en" });
  if (featureType) params.set("featureType", featureType);
  if (process.env.NOMINATIM_EMAIL) params.set("email", process.env.NOMINATIM_EMAIL);
  const [r] = await getJson<NominatimResult[]>(`${nominatimUrl()}/search?${params}`);
  if (!r) return null;
  return {
    place: {
      id: `${r.osm_type}/${r.osm_id}`,
      name: r.name || query.split(",")[0],
      address: r.display_name ?? null,
      lat: Number(r.lat),
      lng: Number(r.lon),
      mapsUrl: osmUrl(r.osm_type, r.osm_id),
      photos: [],
    },
    wikidata: r.extratags?.wikidata ?? null,
  };
}

/** The place for a query, null if there is none. Throws if a service failed. */
async function lookup(query: string): Promise<Place | null> {
  const area = query.startsWith(AREA_PREFIX) ? query.slice(AREA_PREFIX.length).trim() : null;
  // Areas: towns, cities, and regions first, then countries. Nothing else, so
  // an ambiguous name doesn't land on a building or a footpath elsewhere.
  const found = area ? ((await searchNominatim(area, "settlement")) ?? (await searchNominatim(area, "country"))) : await searchNominatim(query);
  if (!found) return null;
  // A missing photo shouldn't lose the place.
  const photo = found.wikidata ? await wikidataPhoto(found.wikidata).catch(() => null) : null;
  return { ...found.place, photos: photo ? [photo] : [] };
}

// ---------- Photos ----------

/** Plain text from Commons' HTML metadata (author fields are often links). */
export function plainText(html: string | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 120) : null;
}

/** Rewrites a Commons thumbnail URL to another width ("…/1280px-File.jpg" → "…/330px-File.jpg"). */
export function thumbWidth(url: string, width: number): string {
  return url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
}

interface CommonsImageInfo {
  thumburl?: string;
  url: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value?: string }>;
}

/** The image (P18) of a Wikidata item, with its credit and license. */
async function wikidataPhoto(qid: string): Promise<PlacePhoto | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  const claims = await getJson<{ claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] } }>(
    `${wikidataUrl()}/w/api.php?${new URLSearchParams({ action: "wbgetclaims", entity: qid, property: "P18", format: "json" })}`,
  );
  const file = claims.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!file) return null;
  const info = await getJson<{ query?: { pages?: Record<string, { imageinfo?: CommonsImageInfo[] }> } }>(
    `${commonsUrl()}/w/api.php?${new URLSearchParams({
      action: "query",
      format: "json",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "1280",
      iiextmetadatafilter: "Artist|LicenseShortName",
      titles: `File:${file}`,
    })}`,
  );
  const image = Object.values(info.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!image) return null;
  const src = image.thumburl ?? image.url;
  return {
    src,
    thumb: thumbWidth(src, 330),
    author: plainText(image.extmetadata?.Artist?.value),
    license: plainText(image.extmetadata?.LicenseShortName?.value),
    sourceUrl: image.descriptionurl ?? null,
  };
}

// ---------- Cached resolution ----------

/** Lookups in progress, so two tabs asking at once share one request. */
const inFlight = new Map<string, Promise<Place | null | undefined>>();

/**
 * Returns places for the queries, keyed by normalizeQuery: every cached one,
 * plus up to MAX_NEW_LOOKUPS new lookups. Queries left out haven't been looked
 * up yet; ask again. Failed lookups come back as null and aren't cached.
 */
export async function resolvePlaces(queries: string[]): Promise<Record<string, Place | null>> {
  const byKey = new Map<string, string>();
  for (const q of queries) if (q.trim()) byKey.set(normalizeQuery(q), q.trim());
  const keys = [...byKey.keys()].slice(0, MAX_QUERIES);
  if (keys.length === 0) return {};

  const db = await getDb();
  const cached = await db
    .select()
    .from(s.placeCache)
    .where(and(inArray(s.placeCache.query, keys), gt(s.placeCache.fetchedAt, new Date(Date.now() - CACHE_TTL_MS))));
  const result: Record<string, Place | null> = {};
  for (const row of cached) result[row.query] = row.place;

  // One at a time, in the order asked: destinations first, so photos show early.
  for (const key of keys.filter((k) => !(k in result)).slice(0, MAX_NEW_LOOKUPS)) {
    let pending = inFlight.get(key);
    if (!pending) {
      pending = lookup(byKey.get(key)!)
        .then(async (place) => {
          await db
            .insert(s.placeCache)
            .values({ query: key, place, fetchedAt: new Date() })
            .onConflictDoUpdate({ target: s.placeCache.query, set: { place: sql.raw("excluded.place"), fetchedAt: new Date() } });
          return place;
        })
        .catch((err) => {
          console.error(`Place lookup failed for "${byKey.get(key)}":`, (err as Error).message);
          return undefined;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    result[key] = (await pending) ?? null;
  }
  return result;
}
