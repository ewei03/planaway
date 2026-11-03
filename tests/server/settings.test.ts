import { describe, expect, it } from "vitest";
import { COMMON_CURRENCIES, CURRENCY_CODES, currencyName, OTHER_CURRENCIES } from "@/lib/currencies";
import { DEFAULT_SETTINGS, describeDefaults, parseSettings, UserSettings } from "@/lib/settings";

describe("parseSettings", () => {
  it("fills in defaults for an empty or missing row", () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and drops only the bad ones", () => {
    const s = parseSettings({
      theme: "neon",
      activityColors: { food: "#ff0000", rest: "red", spaceship: "#00ff00" },
      defaults: { currency: "eur", origin: "  SFO  ", travelMode: "boat", travelers: 0, pace: "relaxed", language: "klingon" },
    });
    expect(s.theme).toBe("system");
    expect(s.activityColors).toEqual({ food: "#ff0000" });
    expect(s.defaults).toEqual({ currency: "EUR", origin: "SFO", travelMode: null, travelers: null, pace: "relaxed", language: null });
  });
});

describe("UserSettings (what the API accepts)", () => {
  it("rejects a bad value instead of resetting it", () => {
    expect(UserSettings.safeParse({ ...DEFAULT_SETTINGS, theme: "neon" }).success).toBe(false);
    expect(UserSettings.safeParse({ ...DEFAULT_SETTINGS, activityColors: { food: "red" } }).success).toBe(false);
    expect(UserSettings.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe("describeDefaults", () => {
  const none = DEFAULT_SETTINGS.defaults;

  it("says nothing when no defaults are set", () => {
    expect(describeDefaults(none)).toEqual([]);
  });

  it("lists what's set, folding the travel mode into the starting point", () => {
    expect(describeDefaults({ currency: "USD", origin: "SFO", travelMode: "fly", travelers: 2, pace: "relaxed", language: "ja" })).toEqual([
      "Starting point: SFO (usually flies)",
      "Travelers: 2",
      "Currency: USD",
      "Pace: relaxed",
      "Language: write the itinerary and your replies in Japanese",
    ]);
    expect(describeDefaults({ ...none, travelMode: "drive" })).toEqual(["Getting there: usually drives"]);
  });
});

describe("currencies", () => {
  it("names every currency, newer ones included", () => {
    expect(CURRENCY_CODES.length).toBeGreaterThan(140);
    expect(currencyName("JPY")).toBe("Japanese Yen");
    expect(currencyName("XCG")).toBe("Caribbean Guilder");
    for (const code of CURRENCY_CODES) expect(currencyName(code)).not.toBe(code);
  });

  it("lists the common ones first, then the rest by name, each once", () => {
    expect(new Set([...COMMON_CURRENCIES, ...OTHER_CURRENCIES]).size).toBe(CURRENCY_CODES.length);
    const keys = OTHER_CURRENCIES.map((c) => currencyName(c).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
    expect(keys).toEqual([...keys].sort());
    // Accented names sort as if unaccented, the same on every machine.
    expect(OTHER_CURRENCIES.indexOf("CRC")).toBeLessThan(OTHER_CURRENCIES.indexOf("CUP"));
  });

  it("accepts any current currency as a default, and rejects retired or made-up codes", () => {
    const parse = (currency: string) => UserSettings.safeParse({ ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults, currency } });
    expect(parse("vnd").success).toBe(true);
    expect(parse("HRK").success).toBe(false); // the kuna, replaced by the euro
    expect(parse("ABC").success).toBe(false);
  });
});
