import type { Itinerary } from "@/lib/itinerary";
import sample from "./itinerary.json";

/** A fresh, deep copy of the sample itinerary, so tests can mutate it freely. */
export function sampleItinerary(): Itinerary {
  return structuredClone(sample) as Itinerary;
}
