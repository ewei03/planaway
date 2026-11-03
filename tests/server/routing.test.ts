import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

import * as routesRoute from "@/app/api/routes/route";
import { haversine, legKey, type LatLng } from "@/lib/route";
import { joinSteps, MAX_NEW_ROUTES, resolveLegs, WALK_LIMIT_M } from "@/lib/routing";

// A stand-in for the FOSSGIS OSRM servers: walking is 1.3× the straight line
// at 1.3 m/s; driving is 1.2× it at 10 m/s. Each leg is one step through its midpoint.

let calls: { profile: string; points: LatLng[] }[];
let status: number;

beforeEach(() => {
  process.env.ROUTING_INTERVAL_MS = "0";
  calls = [];
  status = 200;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const m = /^\/routed-(foot|car)\/route\/v1\/driving\/(.+)$/.exec(url.pathname);
    if (url.host !== "routing.openstreetmap.de" || !m) return new Response("not found", { status: 404 });
    const points = m[2].split(";").map((c) => {
      const [lng, lat] = c.split(",").map(Number);
      return { lat, lng };
    });
    calls.push({ profile: m[1], points });
    if (status !== 200) return new Response("nope", { status });
    const [stretch, speed] = m[1] === "foot" ? [1.3, 1.3] : [1.2, 10];
    const legs = points.slice(1).map((b, i) => {
      const a = points[i];
      const distance = haversine(a, b) * stretch;
      const mid: [number, number] = [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2];
      return { distance, duration: distance / speed, steps: [{ geometry: { coordinates: [[a.lng, a.lat], mid, [b.lng, b.lat]] } }] };
    });
    return Response.json({ code: "Ok", routes: [{ legs }] });
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  authMock.mockResolvedValue({ user: { id: "u1", name: "Maya" } });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ROUTING_INTERVAL_MS;
});

// The cache persists across tests in this file, so each test walks its own patch of Kyoto.
let n = 0;
/** Points about 400 m apart heading east, then `farKm` further on if given. */
function day(stops = 3, farKm?: number): LatLng[] {
  const base = { lat: 35 + ++n * 0.01, lng: 135.7 };
  const pts = Array.from({ length: stops }, (_, i) => ({ lat: base.lat, lng: base.lng + i * 0.0044 }));
  if (farKm) pts.push({ lat: base.lat, lng: pts.at(-1)!.lng + farKm / 91 });
  return pts;
}
const pairs = (seq: LatLng[]) => seq.slice(1).map((b, i) => legKey(seq[i], b));

describe("resolveLegs", () => {
  it("walks a day's short hops with one request, leg by leg along the streets", async () => {
    const seq = day(4);
    const legs = await resolveLegs([seq]);
    expect(calls).toHaveLength(1);
    expect(calls[0].profile).toBe("foot");
    expect(calls[0].points).toHaveLength(4);
    expect(Object.keys(legs)).toEqual(pairs(seq));
    const first = legs[pairs(seq)[0]]!;
    expect(first.mode).toBe("walk");
    expect(first.meters).toBeGreaterThan(400);
    expect(first.meters).toBeLessThan(WALK_LIMIT_M);
    expect(first.path).toHaveLength(3);
  });

  it("goes by road where it's too far to walk", async () => {
    const seq = day(2, 12);
    const legs = await resolveLegs([seq]);
    expect(calls.map((c) => c.profile)).toEqual(["foot", "car"]);
    expect(calls[1].points).toEqual([seq[1], seq[2]].map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) })));
    const [walk, drive] = pairs(seq).map((k) => legs[k]!);
    expect(walk.mode).toBe("walk");
    expect(drive.mode).toBe("drive");
    expect(drive.seconds).toBeLessThan(drive.meters / 5);
  });

  it("caches every leg, so asking again costs nothing", async () => {
    const seq = day(3);
    const first = await resolveLegs([seq]);
    calls = [];
    expect(await resolveLegs([seq])).toEqual(first);
    expect(calls).toHaveLength(0);
  });

  it("routes only the stretch that changed", async () => {
    const seq = day(4);
    await resolveLegs([seq]);
    calls = [];
    const moved = [...seq.slice(0, 3), { lat: seq[3].lat + 0.002, lng: seq[3].lng }];
    const legs = await resolveLegs([moved]);
    expect(calls).toHaveLength(1);
    expect(calls[0].points).toHaveLength(2);
    expect(Object.keys(legs).sort()).toEqual(pairs(moved).sort());
  });

  it("needs no request for staying put, and skips stops too far apart for a day out", async () => {
    const [a] = day(1);
    const far = { lat: a.lat, lng: a.lng + 5 };
    const legs = await resolveLegs([[a, a, far]]);
    expect(calls).toHaveLength(0);
    expect(legs[legKey(a, a)]).toMatchObject({ meters: 0, seconds: 0 });
    expect(legs[legKey(a, far)]).toBeNull();
  });

  it("does a few new routes per call and leaves the rest for the next", async () => {
    const days = Array.from({ length: MAX_NEW_ROUTES + 2 }, () => day(2));
    const legs = await resolveLegs(days);
    expect(calls).toHaveLength(MAX_NEW_ROUTES);
    // The first days first.
    expect(Object.keys(legs)).toEqual(days.slice(0, MAX_NEW_ROUTES).flatMap(pairs));
    calls = [];
    await resolveLegs(days);
    expect(calls).toHaveLength(2);
  });

  it("reports a failed route as missing without caching it", async () => {
    const seq = day(2);
    status = 503;
    expect(await resolveLegs([seq])).toEqual({ [pairs(seq)[0]]: null });
    status = 200;
    calls = [];
    expect((await resolveLegs([seq]))[pairs(seq)[0]]).toMatchObject({ mode: "walk" });
    expect(calls).toHaveLength(1);
  });

  it("remembers when there's no route at all", async () => {
    const seq = day(2);
    status = 400;
    expect(await resolveLegs([seq])).toEqual({ [pairs(seq)[0]]: null });
    status = 200;
    calls = [];
    expect(await resolveLegs([seq])).toEqual({ [pairs(seq)[0]]: null });
    expect(calls).toHaveLength(0);
  });
});

describe("joinSteps", () => {
  it("joins step paths, rounded to about a metre, without repeating shared points", () => {
    expect(
      joinSteps([
        [
          [135.7000001, 35.0000004],
          [135.70002, 35.00001],
        ],
        [
          [135.70002, 35.00001],
          [135.70005, 35.00002],
        ],
      ]),
    ).toEqual([
      [135.7, 35],
      [135.70002, 35.00001],
      [135.70005, 35.00002],
    ]);
  });
});

describe("POST /api/routes", () => {
  const post = (json: unknown) => routesRoute.POST(new Request("http://localhost/api/routes", { method: "POST", body: JSON.stringify(json) }));

  it("routes each day's stops for signed-in users", async () => {
    const seq = day(3);
    const res = await post({ sequences: [seq.map((p) => [p.lat, p.lng])] });
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()).legs)).toEqual(pairs(seq));
  });

  it("requires sign-in", async () => {
    authMock.mockResolvedValue(null);
    expect((await post({ sequences: [] })).status).toBe(401);
  });

  it.each([{ sequences: "Kyoto" }, { sequences: ["x"] }, { sequences: [[[35]]] }, { sequences: [[[95, 135]]] }, { sequences: [[["35", "135"]]] }])(
    "rejects %j",
    async (body) => {
      expect((await post(body)).status).toBe(400);
    },
  );
});
