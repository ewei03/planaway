import { z } from "zod";
import { isCurrencyCode } from "./currencies";
import { ACTIVITY_CATEGORIES } from "./itinerary";

// Per-user settings: how the app looks, and the defaults the agent falls back
// on for anything a trip request leaves out. Stored as JSON on the user row;
// always read through parseSettings, so old or partial rows get defaults.

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const TRAVEL_MODES = ["fly", "drive", "train", "any"] as const;
export const PACES = ["relaxed", "balanced", "packed"] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

/** The built-in color of each activity category (the icon; its circle is a tint of it). */
export const DEFAULT_ACTIVITY_COLORS: Record<ActivityCategory, string> = {
  food: "#a8401f",
  sightseeing: "#0b5c52",
  activity: "#7a5300",
  transport: "#2d4c7c",
  lodging: "#6a3f7e",
  shopping: "#8e2f5a",
  nightlife: "#3f3a8a",
  rest: "#46602c",
  other: "#5e5b54",
};

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable();

export const TripDefaults = z.object({
  /** ISO 4217, e.g. "USD". */
  currency: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine(isCurrencyCode, "Unknown currency")
    .nullable(),
  /** An airport, city, or neighborhood: where trips usually start. */
  origin: optionalText(120),
  /** How the user usually gets there. */
  travelMode: z.enum(TRAVEL_MODES).nullable(),
  travelers: z.number().int().min(1).max(50).nullable(),
  pace: z.enum(PACES).nullable(),
});
export type TripDefaults = z.infer<typeof TripDefaults>;

/** What the settings API accepts: every field, each one valid. */
export const UserSettings = z.object({
  theme: z.enum(THEMES),
  /** Only the categories the user changed; the rest use DEFAULT_ACTIVITY_COLORS. */
  activityColors: z.partialRecord(z.enum(ACTIVITY_CATEGORIES), hexColor),
  defaults: TripDefaults,
});
export type UserSettings = z.infer<typeof UserSettings>;

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  activityColors: {},
  defaults: { currency: null, origin: null, travelMode: null, travelers: null, pace: null },
};

/** `value` if it fits `schema`, else `fallback`. */
function valid<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const r = schema.safeParse(value);
  return r.success ? r.data : fallback;
}

/**
 * Settings as stored (possibly old, partial, or hand-edited), with every field
 * filled in. A bad field falls back to its default without losing the rest.
 */
export function parseSettings(raw: unknown): UserSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = obj.defaults && typeof obj.defaults === "object" ? (obj.defaults as Record<string, unknown>) : {};
  const shape = TripDefaults.shape;
  const colors = obj.activityColors && typeof obj.activityColors === "object" ? obj.activityColors : {};
  return {
    theme: valid(UserSettings.shape.theme, obj.theme, DEFAULT_SETTINGS.theme),
    activityColors: Object.fromEntries(
      Object.entries(colors).filter(([k, v]) => (ACTIVITY_CATEGORIES as readonly string[]).includes(k) && hexColor.safeParse(v).success),
    ),
    defaults: {
      currency: valid(shape.currency, d.currency, null),
      origin: valid(shape.origin, d.origin, null),
      travelMode: valid(shape.travelMode, d.travelMode, null),
      travelers: valid(shape.travelers, d.travelers, null),
      pace: valid(shape.pace, d.pace, null),
    },
  };
}

const MODE_TEXT: Record<(typeof TRAVEL_MODES)[number], string> = {
  fly: "usually flies",
  drive: "usually drives",
  train: "usually takes the train",
  any: "no preference for how to get there",
};

/**
 * The traveler's defaults as lines for the agent, or [] when none are set.
 * The agent applies them only where the request is silent.
 */
export function describeDefaults(d: TripDefaults): string[] {
  const lines: string[] = [];
  const mode = d.travelMode ? MODE_TEXT[d.travelMode] : null;
  if (d.origin) lines.push(`Starting point: ${d.origin}${mode ? ` (${mode})` : ""}`);
  else if (mode) lines.push(`Getting there: ${mode}`);
  if (d.travelers) lines.push(`Travelers: ${d.travelers}`);
  if (d.currency) lines.push(`Currency: ${d.currency}`);
  if (d.pace) lines.push(`Pace: ${d.pace}`);
  return lines;
}
