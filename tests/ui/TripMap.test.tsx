import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullLookup, sampleItinerary } from "../fixtures";

// A minimal stand-in for MapLibre (jsdom has no WebGL) that records what's drawn.

const state = vi.hoisted(() => ({
  markers: [] as { el: HTMLElement; lngLat: [number, number]; popup: { content: HTMLElement | null }; removed: boolean; opened: boolean }[],
  layers: new Map<string, { paint: Record<string, unknown>; coordinates: [number, number][]; features: { properties: Record<string, unknown>; coordinates: [number, number][] }[] }>(),
  fitBounds: [] as unknown[],
  throwOnCreate: false,
}));

vi.mock("maplibre-gl", () => {
  type Geo = { type: string; properties?: Record<string, unknown>; geometry?: { coordinates: [number, number][] }; features?: Geo[] };
  class FakeMap {
    sources = new Map<string, { data: Geo }>();
    constructor() {
      if (state.throwOnCreate) throw new Error("WebGL unavailable");
    }
    addControl() {}
    on(event: string, cb: () => void) {
      if (event === "load") setTimeout(cb, 0);
    }
    remove() {}
    addSource(id: string, source: { data: Geo }) {
      this.sources.set(id, source);
    }
    addLayer(layer: { id: string; source: string; paint: Record<string, unknown>; filter?: [string, unknown, boolean] }) {
      const data = this.sources.get(layer.source)!.data;
      // Only the features the layer's ["==", ["get", "routed"], x] filter lets through.
      const features = (data.features ?? [data])
        .filter((f) => !layer.filter || f.properties?.routed === layer.filter[2])
        .map((f) => ({ properties: f.properties ?? {}, coordinates: f.geometry!.coordinates }));
      state.layers.set(layer.id, { paint: layer.paint, features, coordinates: features.flatMap((f) => f.coordinates) });
    }
    resize() {}
    getLayer(id: string) {
      return state.layers.get(id);
    }
    removeLayer(id: string) {
      state.layers.delete(id);
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    removeSource(id: string) {
      this.sources.delete(id);
    }
    fitBounds(b: unknown) {
      state.fitBounds.push(b);
    }
  }
  class Marker {
    rec: (typeof state.markers)[number];
    constructor({ element }: { element: HTMLElement }) {
      this.rec = { el: element, lngLat: [0, 0], popup: { content: null }, removed: false, opened: false };
      state.markers.push(this.rec);
    }
    setLngLat(ll: [number, number]) {
      this.rec.lngLat = ll;
      return this;
    }
    setPopup(p: { content: HTMLElement | null }) {
      this.rec.popup = p;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      this.rec.removed = true;
    }
    togglePopup() {
      this.rec.opened = !this.rec.opened;
    }
    getPopup() {
      return { isOpen: () => this.rec.opened };
    }
  }
  class Popup {
    content: HTMLElement | null = null;
    setDOMContent(el: HTMLElement) {
      this.content = el;
      return this;
    }
  }
  class LngLatBounds {
    points: unknown[];
    constructor(a: unknown) {
      this.points = [a];
    }
    extend(p: unknown) {
      this.points.push(p);
      return this;
    }
  }
  class NavigationControl {}
  return { Map: FakeMap, Marker, Popup, LngLatBounds, NavigationControl };
});

import { createMapFocus, MapFocusProvider } from "@/components/mapFocus";
import { MapsProvider } from "@/components/places";
import { DAY_COLORS, TripMap, dayColor } from "@/components/TripMap";
import { buildRoute, legKey, type Leg, type LegLookup } from "@/lib/route";

const live = () => state.markers.filter((m) => !m.removed);
const labels = () => live().map((m) => m.el.textContent);
const byTitle = (title: string) => live().find((m) => m.popup.content?.querySelector("strong")?.textContent?.endsWith(title))!;

const noLegs: LegLookup = () => undefined;

function setup(lookup = fullLookup(), itinerary = sampleItinerary(), legs = noLegs, focus = createMapFocus()) {
  render(
    <MapsProvider value={{ styleUrl: "https://example.com/style.json" }}>
      <MapFocusProvider value={focus}>
        <TripMap route={buildRoute(itinerary, lookup)} legs={legs} loading={false} />
      </MapFocusProvider>
    </MapsProvider>,
  );
  return focus;
}

/** Walking legs for every pair of points, 600 m and 8 minutes each, along a bent path. */
const walking: LegLookup = (a, b) => {
  if (legKey(a, b) === legKey(b, b)) return { mode: "walk", meters: 0, seconds: 0, path: [[b.lng, b.lat]] };
  return { mode: "walk", meters: 600, seconds: 480, path: [[a.lng, a.lat], [(a.lng + b.lng) / 2, a.lat], [b.lng, b.lat]] };
};
const memo = (lookup: LegLookup): LegLookup => {
  const legs = new Map<string, Leg | null | undefined>();
  return (a, b) => {
    const k = legKey(a, b);
    if (!legs.has(k)) legs.set(k, lookup(a, b));
    return legs.get(k);
  };
};

beforeEach(() => {
  state.markers = [];
  state.layers.clear();
  state.fitBounds = [];
  state.throwOnCreate = false;
});

describe("TripMap", () => {
  it("draws every day's numbered stops, the stay, flights, and fits the view", async () => {
    setup();
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    expect(labels().sort()).toEqual(["1", "1", "2", "✈", "✈", "🛏"].sort());
    expect([...state.layers.keys()].sort()).toEqual(
      ["planaway-day-1", "planaway-day-1-straight", "planaway-day-2", "planaway-day-2-straight", "planaway-flight-0"].sort(),
    );
    expect(state.layers.get("planaway-day-1")!.paint["line-color"]).toBe(dayColor(1));
    expect(state.fitBounds).toHaveLength(1);
  });

  it("frames the places on the ground, not the flights", async () => {
    setup();
    await vi.waitFor(() => expect(state.fitBounds).toHaveLength(1));
    // The stay and the three stops; the airports are drawn but not framed.
    expect((state.fitBounds[0] as { points: unknown[] }).points).toHaveLength(4 + 1);
  });

  it("frames the flights when nothing else is mapped", async () => {
    const lookup = fullLookup();
    setup((q) => (q.endsWith("airport") ? lookup(q) : undefined));
    await vi.waitFor(() => expect(state.fitBounds).toHaveLength(1));
    expect((state.fitBounds[0] as { points: unknown[] }).points).toHaveLength(2 + 1);
  });

  it("starts and ends each day's line at the stay, straight until the way is known", async () => {
    setup();
    await vi.waitFor(() => expect(state.layers.size).toBeGreaterThan(0));
    // Stay → Nishiki → Pontocho → stay: three dashed legs.
    const legs = state.layers.get("planaway-day-1-straight")!.features;
    expect(legs).toHaveLength(3);
    expect(legs.every((f) => f.coordinates.length === 2)).toBe(true);
    expect(legs[0].coordinates[0]).toEqual(legs[2].coordinates[1]);
    expect(state.layers.get("planaway-day-1")!.features).toHaveLength(0);
    expect(state.layers.get("planaway-day-1-straight")!.paint["line-dasharray"]).toBeDefined();
  });

  it("follows the streets once legs are routed", async () => {
    setup(fullLookup(), sampleItinerary(), memo(walking));
    await vi.waitFor(() => expect(state.layers.size).toBeGreaterThan(0));
    const routed = state.layers.get("planaway-day-1")!.features;
    expect(routed).toHaveLength(3);
    expect(routed[0].coordinates).toHaveLength(3);
    expect(state.layers.get("planaway-day-1-straight")!.features).toHaveLength(0);
    // Leg times are labelled only when one day is shown.
    expect(document.querySelectorAll(".map-leg")).toHaveLength(0);
  });

  it("labels each leg of a day and sums up the day's travel", async () => {
    setup(fullLookup(), sampleItinerary(), memo(walking));
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Day 1" }));
    const labels = live().filter((m) => m.el.className === "map-leg").map((m) => m.el.textContent);
    expect(labels).toEqual(["🚶 8 min · 600 m", "🚶 8 min · 600 m", "🚶 8 min · 600 m"]);
    expect(screen.getByText("Day 1 · Arrival and Nishiki Market")).toBeInTheDocument();
    expect(screen.getByText("2 stops · 24 min getting around · 1.8 km")).toBeInTheDocument();
  });

  it("picks a stop from its pin: the others dim, the view frames it, and its popup opens", async () => {
    const focus = setup();
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    byTitle("Pontocho dinner").el.click();
    expect(focus.get()).toMatchObject({ day: 1, range: { day: 1, from: 2, to: 2 }, docked: false });
    await vi.waitFor(() => expect(byTitle("Pontocho dinner").opened).toBe(true));
    expect(byTitle("Nishiki Market").el).toHaveClass("dim");
    expect(byTitle("Pontocho dinner").el).not.toHaveClass("dim");
    expect((state.fitBounds.at(-1) as { points: unknown[] }).points).toHaveLength(2);
    expect(screen.getByText("Day 1 · Stop 2: Pontocho dinner")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(focus.get().range).toBeNull();
    expect(byTitle("Nishiki Market").el).not.toHaveClass("dim");
  });

  it("highlights the way between picked stops and how long it takes", async () => {
    const focus = setup(fullLookup(), sampleItinerary(), memo(walking));
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    act(() => focus.pick({ day: 1, from: 1, to: 2 }));
    expect(screen.getByText("Day 1 · Stops 1 → 2")).toBeInTheDocument();
    expect(screen.getByText("8 min getting around · 600 m")).toBeInTheDocument();
    const active = state.layers.get("planaway-day-1")!.features.filter((f) => f.properties.active);
    expect(active).toHaveLength(1);
    expect(state.layers.get("planaway-day-1")!.paint["line-opacity"]).toEqual(["case", ["get", "active"], 0.95, 0.25]);
    expect(live().filter((m) => m.el.className === "map-leg")).toHaveLength(1);
  });

  it("keeps an open popup open when routes arrive and the map redraws", async () => {
    const focus = createMapFocus();
    const { rerender } = render(
      <MapsProvider value={{ styleUrl: "https://example.com/style.json" }}>
        <MapFocusProvider value={focus}>
          <TripMap route={buildRoute(sampleItinerary(), fullLookup())} legs={noLegs} loading={false} />
        </MapFocusProvider>
      </MapsProvider>,
    );
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    act(() => focus.pick({ day: 1, from: 1, to: 1 }));
    await vi.waitFor(() => expect(byTitle("Nishiki Market").opened).toBe(true));
    const fits = state.fitBounds.length;
    rerender(
      <MapsProvider value={{ styleUrl: "https://example.com/style.json" }}>
        <MapFocusProvider value={focus}>
          <TripMap route={buildRoute(sampleItinerary(), fullLookup())} legs={memo(walking)} loading={false} />
        </MapFocusProvider>
      </MapsProvider>,
    );
    await vi.waitFor(() => expect(state.layers.get("planaway-day-1")!.features.length).toBeGreaterThan(0));
    expect(byTitle("Nishiki Market").opened).toBe(true);
    // New routes don't move the view.
    expect(state.fitBounds).toHaveLength(fits);
  });

  it("links a stop's popup back to the itinerary", async () => {
    const focus = setup();
    const reveal = vi.spyOn(focus, "reveal");
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    const button = [...byTitle("Todai-ji").popup.content!.querySelectorAll("button")].find((b) => b.textContent === "Show in itinerary")!;
    button.click();
    expect(reveal).toHaveBeenCalledWith("a3");
  });

  it("keeps the map in view on request", async () => {
    const focus = setup();
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: /Keep in view/ }));
    expect(focus.get().docked).toBe(true);
    expect(screen.getByRole("button", { name: /Keep in view/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("lights up a pin while its stop is hovered in the itinerary", async () => {
    const focus = setup();
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    act(() => focus.hover("a1"));
    expect(byTitle("Nishiki Market").el).toHaveClass("hover");
    act(() => focus.hover(null));
    expect(byTitle("Nishiki Market").el).not.toHaveClass("hover");
  });

  it("draws the flight across the Pacific, not the long way round", async () => {
    const lookup = fullLookup();
    const sfo = { ...lookup("SFO airport")!, lat: 37.62, lng: -122.38 };
    setup((q) => (q === "SFO airport" ? sfo : lookup(q)));
    await vi.waitFor(() => expect(state.layers.size).toBeGreaterThan(0));
    const path = state.layers.get("planaway-flight-0")!.coordinates;
    // Unwrapped next to Kyoto (≈135°E): SFO sits at 237.6° rather than -122.4°.
    expect(path[0][0]).toBeCloseTo(237.62, 1);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(10);
    const sfoPin = live().find((m) => m.el.textContent === "✈" && m.lngLat[1] > 37)!;
    expect(sfoPin.lngLat[0]).toBeCloseTo(237.62, 1);
  });

  it("filters to one day, hiding flights", async () => {
    setup();
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Day 2" }));
    expect(screen.getByRole("button", { name: "Day 2" })).toHaveAttribute("aria-pressed", "true");
    expect(labels().sort()).toEqual(["1", "🛏"]);
    expect([...state.layers.keys()]).toEqual(["planaway-day-2", "planaway-day-2-straight"]);
    expect(state.layers.get("planaway-day-2-straight")!.features).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "All days" }));
    expect(labels()).toHaveLength(6);
  });

  it("puts a place's details and photo credit in its popup", async () => {
    setup();
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    const popup = byTitle("Pontocho dinner").popup.content!;
    expect(popup.querySelector("strong")?.textContent).toBe("2. Pontocho dinner");
    expect(popup.textContent).toContain("Day 1 · 19:00");
    expect(popup.querySelector("a")).toHaveAttribute("href", expect.stringMatching(/^https:\/\/www\.openstreetmap\.org\//));
    expect(popup.querySelector("img")?.getAttribute("src")).toContain("330px");
    expect(popup.textContent).toContain("Photo: Aiko, CC BY-SA 4.0");
  });

  it("never interprets names from the web as HTML", async () => {
    const it = sampleItinerary();
    const name = '<img src=x onerror="alert(1)">';
    it.days[0].activities[0].name = name;
    setup(fullLookup(it), it);
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    const popup = byTitle(name).popup.content!;
    expect(popup.querySelector("strong")?.textContent).toBe(`1. ${name}`);
    expect(popup.querySelectorAll("img")).toHaveLength(1);
  });

  it("explains when the browser can't draw maps", async () => {
    state.throwOnCreate = true;
    setup();
    expect(await screen.findByText(/can't show the map/)).toBeInTheDocument();
  });

  it("skips the day filter when nothing is mapped yet", () => {
    setup(() => undefined);
    expect(screen.queryByRole("button", { name: "All days" })).toBeNull();
    expect(screen.getByText("No places to show yet.")).toBeInTheDocument();
  });
});

describe("dayColor", () => {
  it("cycles through the palette", () => {
    expect(dayColor(1)).toBe(DAY_COLORS[0]);
    expect(dayColor(DAY_COLORS.length + 1)).toBe(DAY_COLORS[0]);
  });
});

it("names every pin for screen readers", async () => {
  setup();
  await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
  expect(live().map((m) => m.el.getAttribute("aria-label")).sort()).toEqual(
    ["Airport: KIX", "Airport: SFO", "Day 1, stop 1: Nishiki Market", "Day 1, stop 2: Pontocho dinner", "Day 2, stop 1: Todai-ji", "Stay: Gion Ryokan"].sort(),
  );
});
