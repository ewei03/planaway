import { and, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema as s } from "./db";
import { haversine, legKey, type LatLng, type Leg } from "./route";

// Real routes between a day's stops, for the map and the travel times in the
// timeline. Free and keyless: OSRM on the FOSSGIS servers
// (routing.openstreetmap.de), which route on OpenStreetMap data and ask for
// fair use. So requests are throttled, every leg is cached in route_cache and
// shared by all trips, and each request does a few new routes at a time: the
// browser asks again for whatever is still missing.

const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** New routing requests per call (about a second each); cached legs are always returned. */
export const MAX_NEW_ROUTES = 4;
/** Most sequences (one per day) a call may ask about, and most points in each. */
export const MAX_SEQUENCES = 60;
export const MAX_POINTS = 30;
/** Walk anything up to this far; beyond it, go by road. */
export const WALK_LIMIT_M = 2000;
/** Stops farther apart than this aren't a day's outing; the map draws a straight line. */
const MAX_LEG_M = 300_000;
const USER_AGENT = "PlanAway/1.0 (collaborative trip planner)";

// Overridable to self-host OSRM, or to point tests at a stand-in.
const routingUrl = () => process.env.ROUTING_URL || "https://routing.openstreetmap.de";

const g = globalThis as typeof globalThis & { __planawayRoutingNext?: number };

/** Waits for this process's next routing slot, keeping requests about a second apart. */
async function routingTurn(): Promise<void> {
  const interval = Number(process.env.ROUTING_INTERVAL_MS ?? 1000);
  const now = Date.now();
  const slot = Math.max(now, g.__planawayRoutingNext ?? 0);
  g.__planawayRoutingNext = slot + interval;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

interface OsrmResponse {
  code: string;
  routes?: { legs: { distance: number; duration: number; steps: { geometry: { coordinates: [number, number][] } }[] }[] }[];
}

/** One OSRM route through the points; a leg per consecutive pair, or null if there's no route. */
async function osrm(profile: "foot" | "car", points: LatLng[]): Promise<{ meters: number; seconds: number; path: [number, number][] }[] | null> {
  await routingTurn();
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  // The FOSSGIS servers pick the profile by path; the "driving" segment is required but ignored.
  const url = `${routingUrl()}/routed-${profile}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  // 400 means no route between the points (an island, say), not a failure.
  if (res.status === 400) return null;
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  const data = (await res.json()) as OsrmResponse;
  const route = data.code === "Ok" ? data.routes?.[0] : undefined;
  if (!route) return null;
  return route.legs.map((leg) => ({ meters: leg.distance, seconds: leg.duration, path: joinSteps(leg.steps.map((st) => st.geometry.coordinates)) }));
}

/** Step geometries as one path, rounded to about a metre, without repeated points. */
export function joinSteps(steps: [number, number][][]): [number, number][] {
  const path: [number, number][] = [];
  for (const step of steps) {
    for (const [lng, lat] of step) {
      const pt: [number, number] = [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
      const last = path.at(-1);
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) path.push(pt);
    }
  }
  return path;
}

type Pair = { key: string; from: LatLng; to: LatLng };

/**
 * Routes the missing legs of one sequence: a single walking route through the
 * stretch that has them, then a road route for each leg too long to walk.
 * Returns the legs found, keyed by legKey, and how many requests it made.
 */
async function routeSequence(points: LatLng[], missing: Set<string>): Promise<{ legs: Map<string, Leg | null>; requests: number }> {
  const legs = new Map<string, Leg | null>();
  const pairs: Pair[] = points.slice(1).map((to, i) => ({ key: legKey(points[i], to), from: points[i], to }));
  const todo = pairs.map((p) => missing.has(p.key));
  const first = todo.indexOf(true);
  const last = todo.lastIndexOf(true);
  if (first < 0) return { legs, requests: 0 };

  const walked = await osrm("foot", points.slice(first, last + 2));
  let requests = 1;
  for (let i = first; i <= last; i++) {
    const pair = pairs[i];
    const walk = walked?.[i - first];
    if (walk && walk.meters <= WALK_LIMIT_M) {
      legs.set(pair.key, { mode: "walk", ...walk });
      continue;
    }
    const [drive] = (await osrm("car", [pair.from, pair.to])) ?? [];
    requests++;
    legs.set(pair.key, drive ? { mode: "drive", ...drive } : walk ? { mode: "walk", ...walk } : null);
  }
  return { legs, requests };
}

/** Sequences being routed, so two tabs asking at once share one request. */
const inFlight = new Map<string, Promise<{ legs: Map<string, Leg | null>; requests: number }>>();

/**
 * Returns the legs between consecutive points of each sequence, keyed by
 * legKey: every cached one, plus new routes for a few sequences. Legs left out
 * haven't been routed yet; ask again. Failed routes come back as null and
 * aren't cached.
 */
export async function resolveLegs(sequences: LatLng[][]): Promise<Record<string, Leg | null>> {
  const result: Record<string, Leg | null> = {};
  const wanted = new Set<string>();
  for (const seq of sequences) {
    for (let i = 1; i < seq.length; i++) {
      const [a, b] = [seq[i - 1], seq[i]];
      const key = legKey(a, b);
      if (wanted.has(key) || key in result) continue;
      // Same place twice (back to the hotel for lunch): nothing to route.
      if (key === legKey(b, b)) result[key] = { mode: "walk", meters: 0, seconds: 0, path: [[b.lng, b.lat]] };
      else if (haversine(a, b) > MAX_LEG_M) result[key] = null;
      else wanted.add(key);
    }
  }
  if (wanted.size === 0) return result;

  const db = await getDb();
  const cached = await db
    .select()
    .from(s.routeCache)
    .where(and(inArray(s.routeCache.key, [...wanted]), gt(s.routeCache.fetchedAt, new Date(Date.now() - CACHE_TTL_MS))));
  for (const row of cached) {
    result[row.key] = row.leg;
    wanted.delete(row.key);
  }

  // In the order asked: the first days first, so they fill in early.
  let budget = MAX_NEW_ROUTES;
  for (const seq of sequences) {
    if (budget <= 0 || wanted.size === 0) break;
    const missing = new Set(
      seq
        .slice(1)
        .map((to, i) => legKey(seq[i], to))
        .filter((k) => wanted.has(k)),
    );
    if (missing.size === 0) continue;
    const flightKey = [...missing].join("|");
    let pending = inFlight.get(flightKey);
    if (!pending) {
      pending = routeSequence(seq, missing)
        .then(async (routed) => {
          const rows = [...routed.legs].map(([key, leg]) => ({ key, leg, fetchedAt: new Date() }));
          if (rows.length) {
            await db
              .insert(s.routeCache)
              .values(rows)
              .onConflictDoUpdate({ target: s.routeCache.key, set: { leg: sql.raw("excluded.leg"), fetchedAt: sql.raw("excluded.fetched_at") } });
          }
          return routed;
        })
        .catch((err) => {
          console.error("Routing failed:", (err as Error).message);
          return { legs: new Map([...missing].map((k) => [k, null] as const)), requests: 1 };
        })
        .finally(() => inFlight.delete(flightKey));
      inFlight.set(flightKey, pending);
    }
    const routed = await pending;
    budget -= Math.max(1, routed.requests);
    for (const [key, leg] of routed.legs) {
      result[key] = leg;
      wanted.delete(key);
    }
  }
  return result;
}
