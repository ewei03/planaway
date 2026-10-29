import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullLookup, sampleItinerary } from "../fixtures";

// A minimal stand-in for MapLibre (jsdom has no WebGL) that records what's drawn.

const state = vi.hoisted(() => ({
  markers: [] as { el: HTMLElement; lngLat: [number, number]; popup: { content: HTMLElement | null }; removed: boolean }[],
  layers: new Map<string, { paint: Record<string, unknown>; coordinates: [number, number][] }>(),
  fitBounds: [] as unknown[],
  throwOnCreate: false,
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    sources = new Map<string, { data: { geometry: { coordinates: [number, number][] } } }>();
    constructor() {
      if (state.throwOnCreate) throw new Error("WebGL unavailable");
    }
    addControl() {}
    on(event: string, cb: () => void) {
      if (event === "load") setTimeout(cb, 0);
    }
    remove() {}
    addSource(id: string, source: { data: { geometry: { coordinates: [number, number][] } } }) {
      this.sources.set(id, source);
    }
    addLayer(layer: { id: string; source: string; paint: Record<string, unknown> }) {
      state.layers.set(layer.id, { paint: layer.paint, coordinates: this.sources.get(layer.source)!.data.geometry.coordinates });
    }
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
      this.rec = { el: element, lngLat: [0, 0], popup: { content: null }, removed: false };
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

import { MapsProvider } from "@/components/places";
import { DAY_COLORS, TripMap, dayColor } from "@/components/TripMap";

const live = () => state.markers.filter((m) => !m.removed);
const labels = () => live().map((m) => m.el.textContent);
const byTitle = (title: string) => live().find((m) => m.popup.content?.querySelector("strong")?.textContent?.endsWith(title))!;

function setup(lookup = fullLookup(), itinerary = sampleItinerary()) {
  return render(
    <MapsProvider value={{ styleUrl: "https://example.com/style.json" }}>
      <TripMap itinerary={itinerary} lookup={lookup} loading={false} />
    </MapsProvider>,
  );
}

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
    expect([...state.layers.keys()].sort()).toEqual(["planaway-day-1", "planaway-day-2", "planaway-flight-0"]);
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

  it("starts and ends each day's line at the stay", async () => {
    setup();
    await vi.waitFor(() => expect(state.layers.size).toBeGreaterThan(0));
    const coords = state.layers.get("planaway-day-1")!.coordinates;
    expect(coords).toHaveLength(4);
    expect(coords[0]).toEqual(coords[3]);
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
    expect([...state.layers.keys()]).toEqual(["planaway-day-2"]);
    expect(state.layers.get("planaway-day-2")!.coordinates).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "All days" }));
    expect(labels()).toHaveLength(6);
  });

  it("puts a place's details and photo credit in its popup", async () => {
    setup();
    await vi.waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    const popup = byTitle("Pontocho dinner").popup.content!;
    expect(popup.querySelector("strong")?.textContent).toBe("2. Pontocho dinner");
    expect(popup.textContent).toContain("Day 1 · 19:00");
    expect(popup.querySelector("a")).toHaveAttribute("href", "https://www.openstreetmap.org/node/4");
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
