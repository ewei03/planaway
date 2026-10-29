import { z } from "zod";

// The itinerary is the structured artifact the agent maintains. The same Zod
// schema validates tool input and generates the tool's JSON schema, so the two
// can't drift. Avoid numeric/length constraints so the schema stays usable
// with strict tool mode if it's slimmed down later.

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

// Stable ids let collaborators' comments stay attached to an item while the
// agent rewrites the itinerary around it.
const itemId = z.string().describe("Stable id. Keep it when you keep or edit this item; use a new unique id for new items.");

export const ACTIVITY_CATEGORIES = [
  "sightseeing",
  "food",
  "activity",
  "transport",
  "lodging",
  "shopping",
  "nightlife",
  "rest",
  "other",
] as const;

export const Activity = z.object({
  id: itemId,
  time: nullableString.describe('Approximate time, e.g. "09:00" or "Morning"'),
  name: z.string(),
  description: z.string(),
  category: z.enum(ACTIVITY_CATEGORIES),
  est_cost: nullableNumber.describe("Estimated cost for the whole party, in the itinerary currency"),
  url: nullableString,
});

export const Day = z.object({
  id: itemId,
  day: z.number().describe("1-based day number"),
  date: nullableString.describe("YYYY-MM-DD if trip dates are known"),
  location: z.string(),
  title: z.string(),
  activities: z.array(Activity),
});

export const Flight = z.object({
  id: itemId,
  from: z.string(),
  to: z.string(),
  date: nullableString.describe("YYYY-MM-DD"),
  carrier: nullableString,
  est_price: nullableNumber.describe("Estimated total for the whole party"),
  booking_url: nullableString,
  notes: nullableString,
});

export const Lodging = z.object({
  id: itemId,
  name: z.string(),
  area: z.string(),
  check_in: nullableString.describe("YYYY-MM-DD"),
  check_out: nullableString.describe("YYYY-MM-DD"),
  nightly_price: nullableNumber,
  booking_url: nullableString,
  notes: nullableString,
});

export const BudgetLine = z.object({
  id: itemId,
  category: z.string(),
  amount: z.number(),
  notes: nullableString,
});

export const Itinerary = z.object({
  title: z.string(),
  summary: z.string().describe("2-4 sentence overview of the trip"),
  origin: nullableString,
  destinations: z.array(z.string()),
  start_date: nullableString.describe("YYYY-MM-DD"),
  end_date: nullableString.describe("YYYY-MM-DD"),
  travelers: z.number(),
  currency: z.string().describe("ISO 4217 code, e.g. USD"),
  budget: z.object({
    estimated_total: nullableNumber,
    breakdown: z.array(BudgetLine),
    notes: nullableString,
  }),
  flights: z.array(Flight),
  lodging: z.array(Lodging),
  days: z.array(Day),
  tips: z
    .array(z.string())
    .describe(
      "Practical tips, one or two sentences each. Wrap the one key phrase of each tip in **double asterisks**, " +
        'e.g. "Buy a **72-hour transit pass** at the airport." Use no other formatting.',
    ),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

export type Itinerary = z.infer<typeof Itinerary>;

const { $schema: _ignored, ...itineraryJsonSchema } = z.toJSONSchema(Itinerary, {
  target: "draft-7",
});

export { itineraryJsonSchema };

/**
 * Gives every item a non-empty id that is unique within the itinerary,
 * keeping the agent's ids where they're valid. Returns the ids it changed.
 */
export function normalizeIds(it: Itinerary): string[] {
  const seen = new Set<string>();
  const changed: string[] = [];
  let n = 0;
  const fix = (item: { id: string }, prefix: string) => {
    if (item.id && !seen.has(item.id)) {
      seen.add(item.id);
      return;
    }
    let id: string;
    do id = `${prefix}${++n}`;
    while (seen.has(id));
    changed.push(`${item.id || "(empty)"} -> ${id}`);
    item.id = id;
    seen.add(id);
  };
  it.flights.forEach((f) => fix(f, "f"));
  it.lodging.forEach((l) => fix(l, "l"));
  it.budget.breakdown.forEach((b) => fix(b, "b"));
  for (const d of it.days) {
    fix(d, "d");
    d.activities.forEach((a) => fix(a, "a"));
  }
  return changed;
}
