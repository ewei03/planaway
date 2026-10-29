import type { Itinerary } from "@/lib/itinerary";
import { AREA_PREFIX, normalizeQuery, placeQueries, type Place, type PlaceLookup } from "@/lib/route";
import sample from "./itinerary.json";

/** A fresh, deep copy of the sample itinerary, so tests can mutate it freely. */
export function sampleItinerary(): Itinerary {
  return structuredClone(sample) as Itinerary;
}

/** A made-up place for a query, at a position derived from its index. */
export function fakePlace(query: string, i = 0): Place {
  const name = query.replace(AREA_PREFIX, "");
  const slug = normalizeQuery(name).replace(/[^a-z0-9]+/g, "-");
  return {
    id: `place-${slug}`,
    name: name.split(",")[0],
    address: `${query}, Japan`,
    lat: 35 + i * 0.01,
    lng: 135.7 + i * 0.01,
    mapsUrl: `https://www.openstreetmap.org/node/${i}`,
    photos: [
      {
        src: `https://upload.wikimedia.org/${slug}/1280px-a.jpg`,
        thumb: `https://upload.wikimedia.org/${slug}/330px-a.jpg`,
        author: "Aiko",
        license: "CC BY-SA 4.0",
        sourceUrl: `https://commons.wikimedia.org/wiki/File:${slug}-a.jpg`,
      },
      {
        src: `https://upload.wikimedia.org/${slug}/1280px-b.jpg`,
        thumb: `https://upload.wikimedia.org/${slug}/330px-b.jpg`,
        author: null,
        license: null,
        sourceUrl: null,
      },
    ],
  };
}

/** A lookup that knows every place in the itinerary. */
export function fullLookup(it: Itinerary = sampleItinerary()): PlaceLookup {
  const places = new Map(placeQueries(it).map((q, i) => [normalizeQuery(q), fakePlace(q, i)]));
  return (q) => places.get(normalizeQuery(q));
}
