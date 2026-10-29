import { describe, expect, it } from "vitest";
import { buildRoute, dayPath, greatCircle, heroPhotos, normalizeQuery, placeQueries, unwrapLng, type PlaceLookup } from "@/lib/route";
import { fakePlace, fullLookup, sampleItinerary } from "../fixtures";

describe("placeQueries", () => {
  it("lists destinations, stays, activities, and airports once each", () => {
    expect(placeQueries(sampleItinerary())).toEqual([
      "area:Kyoto",
      "area:Nara",
      "Gion Ryokan, Gion",
      "Nishiki Market, Kyoto",
      "Pontocho dinner, Kyoto",
      "Todai-ji, Nara",
      "SFO airport",
      "KIX airport",
    ]);
  });

  it("skips transport and rest, which aren't places", () => {
    const it = sampleItinerary();
    it.days[0].activities[0].category = "transport";
    it.days[0].activities[1].category = "rest";
    const queries = placeQueries(it);
    expect(queries).not.toContain("Nishiki Market, Kyoto");
    expect(queries).not.toContain("Pontocho dinner, Kyoto");
  });

  it("dedupes ignoring case and spacing", () => {
    const it = sampleItinerary();
    it.destinations = ["Kyoto", " kyoto  "];
    expect(placeQueries(it).filter((q) => normalizeQuery(q) === "area:kyoto")).toHaveLength(1);
  });

  it("marks destinations and day locations as areas, skipping blank ones", () => {
    const it = sampleItinerary();
    it.days[0].location = "  ";
    const areas = placeQueries(it).filter((q) => q.startsWith("area:"));
    expect(areas).toEqual(["area:Kyoto", "area:Nara"]);
  });

  it("doesn't double up 'airport'", () => {
    const it = sampleItinerary();
    it.flights[0].to = "Kansai International Airport";
    expect(placeQueries(it)).toContain("Kansai International Airport");
  });
});

describe("buildRoute", () => {
  it("numbers each day's stops in itinerary order", () => {
    const route = buildRoute(sampleItinerary(), fullLookup());
    expect(route.days.map((d) => d.stops.map((s) => [s.order, s.label]))).toEqual([
      [
        [1, "Nishiki Market"],
        [2, "Pontocho dinner"],
      ],
      [[1, "Todai-ji"]],
    ]);
    expect(route.days[0].stops[0]).toMatchObject({ id: "a1", kind: "activity", day: 1, detail: "15:00" });
  });

  it("starts and ends each day at that night's stay", () => {
    const route = buildRoute(sampleItinerary(), fullLookup());
    expect(route.days.map((d) => d.lodging?.id)).toEqual(["l1", "l1"]);
    const path = dayPath(route.days[0]);
    expect(path).toHaveLength(4);
    expect(path[0]).toEqual(path[3]);
  });

  it("has no stay for days outside every booking", () => {
    const it = sampleItinerary();
    it.days[1].date = "2027-04-05"; // the check-out day
    expect(buildRoute(it, fullLookup(it)).days[1].lodging).toBeNull();
  });

  it("uses the only stay for undated trips", () => {
    const it = sampleItinerary();
    it.days.forEach((d) => (d.date = null));
    expect(buildRoute(it, fullLookup(it)).days.every((d) => d.lodging?.id === "l1")).toBe(true);
  });

  it("renumbers around places the search couldn't find", () => {
    const lookup = fullLookup();
    const missing: PlaceLookup = (q) => (q.startsWith("Nishiki") ? null : lookup(q));
    const route = buildRoute(sampleItinerary(), missing);
    expect(route.days[0].stops.map((s) => [s.order, s.label])).toEqual([[1, "Pontocho dinner"]]);
  });

  it("draws flights between their airports", () => {
    const route = buildRoute(sampleItinerary(), fullLookup());
    expect(route.flights).toHaveLength(1);
    expect(route.flights[0]).toMatchObject({ id: "f1", label: "SFO → KIX", from: { kind: "airport" }, to: { kind: "airport" } });
  });

  it("skips flights with an unknown airport", () => {
    const lookup = fullLookup();
    const route = buildRoute(sampleItinerary(), (q) => (q === "KIX airport" ? undefined : lookup(q)));
    expect(route.flights).toEqual([]);
  });

  it("is empty before anything is looked up", () => {
    const route = buildRoute(sampleItinerary(), () => undefined);
    expect(route.points).toEqual([]);
    expect(route.days.every((d) => d.stops.length === 0 && d.lodging === null)).toBe(true);
  });

  it("collects every point for fitting the map", () => {
    // 1 stay + 3 activities + 2 airports
    expect(buildRoute(sampleItinerary(), fullLookup()).points).toHaveLength(6);
  });
});

describe("heroPhotos", () => {
  it("uses each destination's first photo", () => {
    const photos = heroPhotos(sampleItinerary(), fullLookup());
    expect(photos.map((p) => [p.label, p.photo.src])).toEqual([
      ["Kyoto", "https://upload.wikimedia.org/kyoto/1280px-a.jpg"],
      ["Nara", "https://upload.wikimedia.org/nara/1280px-a.jpg"],
    ]);
  });

  it("skips destinations without photos, and repeats of the same place", () => {
    const it = sampleItinerary();
    it.destinations = ["Kyoto", "Kyoto City", "Nara"];
    const kyoto = fakePlace("Kyoto");
    const photos = heroPhotos(it, (q) => (q === "area:Nara" ? { ...fakePlace("Nara"), photos: [] } : kyoto));
    expect(photos.map((p) => p.label)).toEqual(["Kyoto"]);
  });
});

describe("unwrapLng", () => {
  it("shifts by whole turns to within 180° of the reference", () => {
    expect(unwrapLng(-122, 135)).toBe(238);
    expect(unwrapLng(135, -122)).toBe(-225);
    expect(unwrapLng(10, 20)).toBe(10);
    expect(unwrapLng(190, 0)).toBe(-170);
  });
});

describe("greatCircle", () => {
  const sfo = { lat: 37.62, lng: -122.38 };
  const kix = { lat: 34.43, lng: 135.24 };

  it("starts and ends at the endpoints", () => {
    const path = greatCircle(sfo, kix);
    expect(path).toHaveLength(65);
    expect(path[0].lat).toBeCloseTo(sfo.lat, 6);
    expect(path[0].lng).toBeCloseTo(sfo.lng, 6);
    expect(path.at(-1)!.lat).toBeCloseTo(kix.lat, 6);
    // Across the Pacific: KIX's longitude, unwrapped west of -180.
    expect(path.at(-1)!.lng).toBeCloseTo(kix.lng - 360, 6);
  });

  it("never jumps across the map", () => {
    const path = greatCircle(sfo, kix);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i].lng - path[i - 1].lng)).toBeLessThan(10);
  });

  it("bends toward the pole, as long flights do", () => {
    const maxLat = Math.max(...greatCircle(sfo, kix).map((p) => p.lat));
    expect(maxLat).toBeGreaterThan(45);
  });

  it("handles identical points", () => {
    expect(greatCircle(sfo, sfo)).toHaveLength(2);
  });
});
