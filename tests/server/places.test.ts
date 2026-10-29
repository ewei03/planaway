import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

import * as placesRoute from "@/app/api/places/route";
import { getDb, schema as s } from "@/lib/db";
import { MAX_NEW_LOOKUPS, plainText, resolvePlaces, thumbWidth } from "@/lib/places";

// Stand-ins for Nominatim, Wikidata, and Commons, keyed by host.

interface Calls {
  nominatim: string[];
  /** featureType of each Nominatim search, or "" */
  featureTypes: string[];
  wikidata: string[];
  commons: string[];
}
let calls: Calls;
let nominatim: (q: string, featureType: string) => Response;

const result = (q: string, extratags: Record<string, string> | null = { wikidata: "Q42" }) => ({
  osm_type: "node",
  osm_id: 7,
  lat: "35.005",
  lon: "135.764",
  name: q.split(",")[0],
  display_name: `${q}, Japan`,
  extratags,
});

beforeEach(() => {
  process.env.NOMINATIM_INTERVAL_MS = "0";
  calls = { nominatim: [], featureTypes: [], wikidata: [], commons: [] };
  nominatim = (q) => Response.json([result(q)]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.host === "nominatim.openstreetmap.org") {
      const featureType = url.searchParams.get("featureType") ?? "";
      calls.nominatim.push(url.searchParams.get("q")!);
      calls.featureTypes.push(featureType);
      return nominatim(url.searchParams.get("q")!, featureType);
    }
    if (url.host === "www.wikidata.org") {
      calls.wikidata.push(url.searchParams.get("entity")!);
      return Response.json({ claims: { P18: [{ mainsnak: { datavalue: { value: "Nishiki Market.jpg" } } }] } });
    }
    if (url.host === "commons.wikimedia.org") {
      calls.commons.push(url.searchParams.get("titles")!);
      return Response.json({
        query: {
          pages: {
            "-1": {
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Nishiki_Market.jpg",
                  thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Nishiki_Market.jpg/1280px-Nishiki_Market.jpg",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Nishiki_Market.jpg",
                  extmetadata: {
                    Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Aiko">Aiko &amp; Ken</a>' },
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                  },
                },
              ],
            },
          },
        },
      });
    }
    return new Response("not found", { status: 404 });
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  authMock.mockResolvedValue({ user: { id: "u1", name: "Maya" } });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NOMINATIM_INTERVAL_MS;
});

// Each test uses its own queries: the cache persists across tests in this file.
let n = 0;
const q = (name: string) => `${name} ${++n}, Kyoto`;

describe("resolvePlaces", () => {
  it("finds the place on OpenStreetMap, with a photo from Wikimedia", async () => {
    const query = q("Nishiki Market");
    const found = await resolvePlaces([query]);
    expect(found[query.toLowerCase()]).toEqual({
      id: "node/7",
      name: query.split(",")[0],
      address: `${query}, Japan`,
      lat: 35.005,
      lng: 135.764,
      mapsUrl: "https://www.openstreetmap.org/node/7",
      photos: [
        {
          src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Nishiki_Market.jpg/1280px-Nishiki_Market.jpg",
          thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Nishiki_Market.jpg/330px-Nishiki_Market.jpg",
          author: "Aiko & Ken",
          license: "CC BY-SA 4.0",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Nishiki_Market.jpg",
        },
      ],
    });
    expect(calls.wikidata).toEqual(["Q42"]);
    expect(calls.commons).toEqual(["File:Nishiki Market.jpg"]);
  });

  it("identifies the app and asks for English names", async () => {
    process.env.NOMINATIM_EMAIL = "ops@example.com";
    await resolvePlaces([q("Gion")]);
    delete process.env.NOMINATIM_EMAIL;
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    const params = new URL(String(url)).searchParams;
    expect(params.get("format")).toBe("jsonv2");
    expect(params.get("accept-language")).toBe("en");
    expect(params.get("email")).toBe("ops@example.com");
    expect((init!.headers as Record<string, string>)["User-Agent"]).toMatch(/^PlanAway\//);
  });

  it("keeps a place without a Wikidata link, just without photos", async () => {
    const query = q("Corner cafe");
    nominatim = (x) => Response.json([result(x, null)]);
    expect((await resolvePlaces([query]))[query.toLowerCase()]?.photos).toEqual([]);
    expect(calls.wikidata).toEqual([]);
  });

  it("keeps the place when the photo lookup fails", async () => {
    const query = q("Todai-ji");
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.host === "nominatim.openstreetmap.org") return Response.json([result(query)]);
      return new Response("down", { status: 503 });
    });
    const place = (await resolvePlaces([query]))[query.toLowerCase()];
    expect(place).toMatchObject({ lat: 35.005, photos: [] });
  });

  it("searches areas among towns, cities, and regions only", async () => {
    const area = `Nara ${++n}`;
    const found = await resolvePlaces([`area:${area}`]);
    expect(calls.nominatim).toEqual([area]);
    expect(calls.featureTypes).toEqual(["settlement"]);
    expect(found[`area:${area.toLowerCase()}`]).toMatchObject({ name: area });
  });

  it("falls back to countries for areas, and to nothing after that", async () => {
    nominatim = (x, featureType) => Response.json(featureType === "country" && x.startsWith("Japan") ? [result(x)] : []);
    const japan = `Japan ${++n}`;
    const coast = `Amalfi Coast ${++n}`;
    const found = await resolvePlaces([`area:${japan}`, `area:${coast}`]);
    expect(found[`area:${japan.toLowerCase()}`]).not.toBeNull();
    expect(found[`area:${coast.toLowerCase()}`]).toBeNull();
    // Never an unrestricted search, which could match a building or a footpath.
    expect(calls.featureTypes).toEqual(["settlement", "country", "settlement", "country"]);
  });

  it("doesn't restrict other searches, airports included", async () => {
    const query = `SFO airport ${++n}`;
    await resolvePlaces([query]);
    expect(calls.nominatim).toEqual([query]);
    expect(calls.featureTypes).toEqual([""]);
  });

  it("caches results, keyed case- and space-insensitively", async () => {
    const query = q("Pontocho");
    await resolvePlaces([query]);
    const again = await resolvePlaces([`  ${query.toUpperCase()} `, query]);
    expect(calls.nominatim).toEqual([query]);
    expect(Object.keys(again)).toEqual([query.toLowerCase()]);
  });

  it("caches misses so they aren't searched again", async () => {
    const query = q("Nowhere");
    nominatim = () => Response.json([]);
    expect(await resolvePlaces([query])).toEqual({ [query.toLowerCase()]: null });
    await resolvePlaces([query]);
    expect(calls.nominatim).toHaveLength(1);
  });

  it("doesn't cache failures", async () => {
    const query = q("Flaky");
    nominatim = () => new Response("slow down", { status: 429 });
    expect(await resolvePlaces([query])).toEqual({ [query.toLowerCase()]: null });
    nominatim = (x) => Response.json([result(x)]);
    expect((await resolvePlaces([query]))[query.toLowerCase()]).not.toBeNull();
    expect(calls.nominatim).toHaveLength(2);
  });

  it("refetches entries older than 30 days", async () => {
    const query = q("Old");
    await resolvePlaces([query]);
    const db = await getDb();
    await db.update(s.placeCache).set({ fetchedAt: new Date(Date.now() - 31 * 86_400_000) });
    await resolvePlaces([query]);
    expect(calls.nominatim).toEqual([query, query]);
  });

  it("does a few new lookups per call, in order, and returns cached ones too", async () => {
    const queries = Array.from({ length: MAX_NEW_LOOKUPS + 3 }, () => q("Many"));
    const first = await resolvePlaces(queries);
    expect(Object.keys(first)).toEqual(queries.slice(0, MAX_NEW_LOOKUPS).map((x) => x.toLowerCase()));
    const second = await resolvePlaces(queries);
    expect(Object.keys(second)).toHaveLength(queries.length);
    expect(calls.nominatim).toEqual(queries);
  });

  it("keeps Nominatim requests a second apart", async () => {
    process.env.NOMINATIM_INTERVAL_MS = "200";
    const times: number[] = [];
    nominatim = (x) => {
      times.push(Date.now());
      return Response.json([result(x, null)]);
    };
    await resolvePlaces([q("A"), q("B"), q("C")]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(190);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(190);
  });

  it("shares one lookup between simultaneous requests", async () => {
    const query = q("Shared");
    const [a, b] = await Promise.all([resolvePlaces([query]), resolvePlaces([query])]);
    expect(a).toEqual(b);
    expect(calls.nominatim).toEqual([query]);
  });

  it("ignores blank queries", async () => {
    expect(await resolvePlaces(["", "   "])).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it.each([
    ['<a href="x">Aiko</a>', "Aiko"],
    ["<span>A &amp; B</span>\n  <i>photographer</i>", "A & B photographer"],
    ["&lt;none&gt;", "<none>"],
    ["", null],
    [undefined, null],
    ["<br>", null],
  ])("plainText(%j) is %j", (html, text) => {
    expect(plainText(html)).toBe(text);
  });

  it("rewrites Commons thumbnail widths", () => {
    expect(thumbWidth("https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/1280px-F.jpg", 330)).toBe("https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/330px-F.jpg");
    // Originals small enough to have no thumbnail stay as they are.
    expect(thumbWidth("https://upload.wikimedia.org/x/a/ab/F.jpg", 330)).toBe("https://upload.wikimedia.org/x/a/ab/F.jpg");
  });
});

describe("POST /api/places", () => {
  const post = (json: unknown) => placesRoute.POST(new Request("http://localhost/api/places", { method: "POST", body: JSON.stringify(json) }));

  it("resolves queries for signed-in users", async () => {
    const query = q("Gion");
    const res = await post({ queries: [query, 42, ""] });
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()).places)).toEqual([query.toLowerCase()]);
  });

  it("requires sign-in", async () => {
    authMock.mockResolvedValue(null);
    expect((await post({ queries: ["x"] })).status).toBe(401);
  });

  it("validates the body", async () => {
    expect((await post({ queries: "Kyoto" })).status).toBe(400);
  });
});
