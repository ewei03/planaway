import { describe, expect, it } from "vitest";
import { Itinerary, itineraryJsonSchema, normalizeIds } from "@/lib/itinerary";
import { sampleItinerary } from "../fixtures";

describe("Itinerary schema", () => {
  it("accepts a complete itinerary", () => {
    expect(Itinerary.safeParse(sampleItinerary()).success).toBe(true);
  });

  it("rejects an unknown activity category", () => {
    const it = sampleItinerary();
    (it.days[0].activities[0] as { category: string }).category = "karaoke";
    expect(Itinerary.safeParse(it).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { title: _omit, ...rest } = sampleItinerary();
    expect(Itinerary.safeParse(rest).success).toBe(false);
  });

  it("requires nullable fields to be present (null, not undefined)", () => {
    const it = sampleItinerary() as unknown as { origin?: string | null };
    delete it.origin;
    expect(Itinerary.safeParse(it).success).toBe(false);
  });

  it("exports a JSON schema without $schema for the tool definition", () => {
    expect(itineraryJsonSchema).not.toHaveProperty("$schema");
    expect(itineraryJsonSchema).toMatchObject({ type: "object" });
    expect((itineraryJsonSchema as { required: string[] }).required).toEqual(
      expect.arrayContaining(["title", "days", "flights", "lodging", "budget"]),
    );
  });
});

describe("normalizeIds", () => {
  it("leaves unique ids alone", () => {
    const it = sampleItinerary();
    expect(normalizeIds(it)).toEqual([]);
    expect(it).toEqual(sampleItinerary());
  });

  it("assigns ids to items with empty ids", () => {
    const it = sampleItinerary();
    it.flights[0].id = "";
    it.days[1].activities[0].id = "";
    const changed = normalizeIds(it);
    expect(changed).toHaveLength(2);
    expect(it.flights[0].id).toMatch(/^f\d+$/);
    expect(it.days[1].activities[0].id).toMatch(/^a\d+$/);
  });

  it("renames duplicates, keeping the first occurrence", () => {
    const it = sampleItinerary();
    it.days[0].activities[1].id = "a1";
    const changed = normalizeIds(it);
    expect(it.days[0].activities[0].id).toBe("a1");
    expect(it.days[0].activities[1].id).not.toBe("a1");
    expect(changed).toEqual([`a1 -> ${it.days[0].activities[1].id}`]);
  });

  it("treats ids as unique across item types", () => {
    const it = sampleItinerary();
    it.lodging[0].id = "f1"; // collides with the flight
    normalizeIds(it);
    expect(it.flights[0].id).toBe("f1");
    expect(it.lodging[0].id).not.toBe("f1");
  });

  it("never generates an id that is already taken", () => {
    const it = sampleItinerary();
    // The generator would try "a1" first; the existing a1 must not be reused.
    it.days[0].activities[1].id = "";
    normalizeIds(it);
    const ids = [
      ...it.flights,
      ...it.lodging,
      ...it.budget.breakdown,
      ...it.days,
      ...it.days.flatMap((d) => d.activities),
    ].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
