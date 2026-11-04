import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

import * as nearRoute from "@/app/api/places/near/route";
import * as suggestRoute from "@/app/api/places/suggest/route";
import { findNear, photonSuggestion, searchAirports, suggestPlaces } from "@/lib/placeSearch";

let photonQueries: string[];
let photon: (q: string) => Response;

const feature = (properties: Record<string, string>) => ({ type: "Feature", properties });

beforeEach(() => {
  photonQueries = [];
  photon = () => Response.json({ features: [] });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.host !== "photon.komoot.io") throw new Error(`Unexpected fetch to ${url}`);
    photonQueries.push(url.searchParams.get("q")!);
    return photon(url.searchParams.get("q")!);
  });
  authMock.mockResolvedValue({ user: { id: "u1", name: "Maya" } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchAirports", () => {
  it("finds an airport by its code, in any case", () => {
    expect(searchAirports("sfo")[0]).toEqual({
      kind: "airport",
      label: "San Francisco International Airport (SFO)",
      detail: "San Francisco, United States",
      value: "San Francisco International Airport (SFO), San Francisco, United States",
    });
  });

  it("finds airports by the start of each word of their name or city, largest first", () => {
    expect(searchAirports("heathrow")[0].label).toBe("London Heathrow Airport (LHR)");
    // The city's own airport before ones that only mention it.
    expect(searchAirports("san fran")[0].label).toBe("San Francisco International Airport (SFO)");
    expect(searchAirports("zzzz")).toEqual([]);
  });
});

describe("photonSuggestion", () => {
  it("labels cities, regions, and addresses", () => {
    expect(photonSuggestion(feature({ osm_key: "place", osm_value: "city", name: "Oakland", state: "California", country: "United States" }))).toMatchObject({
      kind: "city",
      label: "Oakland",
      detail: "California, United States",
    });
    expect(photonSuggestion(feature({ osm_key: "boundary", osm_value: "administrative", name: "Bavaria", country: "Germany" }))?.kind).toBe("region");
    expect(
      photonSuggestion(feature({ osm_key: "building", osm_value: "house", housenumber: "1", street: "Infinite Loop", city: "Cupertino", country: "United States" })),
    ).toMatchObject({ kind: "address", label: "1 Infinite Loop", detail: "Cupertino, United States" });
  });

  it("shows the street only for addresses", () => {
    expect(photonSuggestion(feature({ osm_key: "railway", osm_value: "station", name: "Kyoto", street: "Hachijo Street", city: "Kyoto", country: "Japan" }))).toMatchObject({
      kind: "place",
      detail: "Japan",
    });
  });

  it("doesn't repeat the name in the detail", () => {
    expect(photonSuggestion(feature({ osm_key: "place", osm_value: "city", name: "Tokyo", city: "Tokyo", state: "Tokyo", country: "Japan" }))?.detail).toBe("Japan");
  });
});

describe("suggestPlaces", () => {
  it("leads with the best place, then airports, leaving out the place search's own airports", async () => {
    photon = () =>
      Response.json({
        features: [
          feature({ osm_key: "aeroway", osm_value: "aerodrome", name: "Oakland San Francisco Bay Airport", city: "Oakland" }),
          feature({ osm_key: "place", osm_value: "city", name: "Oakland", state: "California", country: "United States" }),
        ],
      });
    const real = await suggestPlaces("oakland");
    expect(real.map((s) => s.kind)).toEqual(["city", "airport"]);
    expect(real[1].label).toContain("(OAK)");
  });

  it("ranks towns above stations and other places with the same name", async () => {
    photon = () =>
      Response.json({
        features: [
          feature({ osm_key: "railway", osm_value: "station", name: "Kyoto", country: "Japan" }),
          feature({ osm_key: "place", osm_value: "city", name: "Kyoto", state: "Kyoto Prefecture", country: "Japan" }),
        ],
      });
    expect((await suggestPlaces("kyoto")).map((s) => s.kind)).toEqual(["city", "place"]);
  });

  it("puts the airport first when its code was typed", async () => {
    photon = () => Response.json({ features: [feature({ osm_key: "place", osm_value: "village", name: "Sfo", country: "Denmark" })] });
    expect((await suggestPlaces("SFO")).map((s) => s.label)).toEqual(["San Francisco International Airport (SFO)", "Sfo"]);
  });

  it("ignores very short queries and remembers recent ones", async () => {
    expect(await suggestPlaces("a")).toEqual([]);
    await suggestPlaces("Lisbon remembered");
    await suggestPlaces("  lisbon   REMEMBERED ");
    expect(photonQueries.filter((q) => q === "Lisbon remembered")).toHaveLength(1);
  });

  it("still suggests airports when the place search is down, and tries again next time", async () => {
    photon = () => new Response("busy", { status: 503 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await suggestPlaces("LHR")).map((s) => s.label)).toEqual(["London Heathrow Airport (LHR)"]);
    await suggestPlaces("LHR");
    expect(photonQueries.filter((q) => q === "LHR")).toHaveLength(2);
  });
});

describe("GET /api/places/suggest", () => {
  it("needs a signed-in user", async () => {
    authMock.mockResolvedValue(null);
    expect((await suggestRoute.GET(new Request("http://localhost/api/places/suggest?q=SFO"))).status).toBe(401);
  });

  it("returns suggestions", async () => {
    const res = await suggestRoute.GET(new Request("http://localhost/api/places/suggest?q=NRT"));
    expect((await res.json()).suggestions[0].label).toBe("Narita International Airport (NRT)");
  });
});

describe("findNear", () => {
  const kyoto = { lat: 35.0, lng: 135.76 };
  const at = (lat: number, lng: number, properties: Record<string, unknown>) => ({ type: "Feature", geometry: { coordinates: [lng, lat] }, properties });
  // Each test asks about a different name: answers are remembered.

  it("finds the closest good match, steered toward the day's places", async () => {
    photon = () =>
      Response.json({ features: [at(35.004, 135.771, { osm_type: "N", osm_id: 42, osm_key: "amenity", name: "Kinkaku-ji", city: "Kyoto", country: "Japan" })] });
    const place = await findNear("Kinkaku-ji", kyoto);
    expect(place).toEqual({
      id: "node/42",
      name: "Kinkaku-ji",
      address: "Kyoto, Japan",
      lat: 35.004,
      lng: 135.771,
      mapsUrl: "https://www.openstreetmap.org/node/42",
      photos: [],
      guess: true,
    });
    const call = vi.mocked(fetch).mock.calls.at(-1)![0];
    expect(new URL(String(call)).searchParams.get("lat")).toBe("35");
    expect(new URL(String(call)).searchParams.get("lon")).toBe("135.76");
  });

  it("drops trailing words until something nearby turns up", async () => {
    photon = (q) => Response.json({ features: q.trim() === "Pontocho" ? [at(35.005, 135.77, { osm_type: "W", osm_id: 7, name: "Pontocho" })] : [] });
    const place = await findNear("Pontocho evening dinner", kyoto);
    expect(photonQueries).toEqual(["Pontocho evening dinner", "Pontocho evening", "Pontocho"]);
    expect(place).toMatchObject({ id: "way/7", name: "Pontocho" });
  });

  it("ignores matches far from the day, and gives up after three tries", async () => {
    // A Pontocho in Tokyo is no help on a day in Kyoto.
    photon = () => Response.json({ features: [at(35.68, 139.76, { osm_type: "N", osm_id: 1, name: "Pontocho" })] });
    expect(await findNear("Late night Pontocho bar crawl", kyoto)).toBeNull();
    expect(photonQueries).toHaveLength(3);
  });

  it("never shortens a name to a tiny word", async () => {
    photon = () => Response.json({ features: [] });
    await findNear("The Thing", kyoto);
    expect(photonQueries).toEqual(["The Thing"]);
  });

  it("remembers answers, and doesn't remember failures", async () => {
    photon = () => new Response("down", { status: 503 });
    await expect(findNear("Gion Corner", kyoto)).rejects.toThrow("503");
    photon = () => Response.json({ features: [at(35.0, 135.775, { osm_type: "N", osm_id: 3, name: "Gion Corner" })] });
    expect(await findNear("Gion Corner", kyoto)).toMatchObject({ name: "Gion Corner" });
    expect(await findNear("gion  corner", kyoto)).toMatchObject({ name: "Gion Corner" });
    expect(photonQueries).toEqual(["Gion Corner", "Gion Corner"]);
  });
});

describe("GET /api/places/near", () => {
  const get = (qs: string) => nearRoute.GET(new Request(`http://localhost/api/places/near?${qs}`));

  it("needs a signed-in user", async () => {
    authMock.mockResolvedValue(null);
    expect((await get("q=Nishiki&lat=35&lng=135.7")).status).toBe(401);
  });

  it("checks the name and coordinates", async () => {
    expect((await get("lat=35&lng=135.7")).status).toBe(400);
    expect((await get("q=Nishiki&lat=95&lng=135.7")).status).toBe(400);
    expect((await get("q=Nishiki&lat=35")).status).toBe(400);
    expect((await get("q=Nishiki&lat=abc&lng=1")).status).toBe(400);
  });

  it("returns the match, or null", async () => {
    photon = () => Response.json({ features: [{ type: "Feature", geometry: { coordinates: [135.765, 35.005] }, properties: { osm_type: "N", osm_id: 9, name: "Nishiki Market" } }] });
    const res = await get("q=Nishiki%20Market%20stroll&lat=35&lng=135.76");
    expect(res.status).toBe(200);
    expect((await res.json()).place).toMatchObject({ name: "Nishiki Market", guess: true });
    photon = () => Response.json({ features: [] });
    expect(await (await get("q=Nowhere%20at%20all&lat=35&lng=135.76")).json()).toEqual({ place: null });
  });

  it("says when the search is down", async () => {
    photon = () => new Response("down", { status: 503 });
    expect((await get("q=Down%20today&lat=35&lng=135.76")).status).toBe(502);
  });
});
