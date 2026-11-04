"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

// What the route map is focused on, shared by the map and the itinerary so
// either can drive the other: pick stops in the timeline and the map follows;
// click a pin and the timeline marks it. A small store rather than React state
// so a change re-renders only the days it touches, not the whole itinerary.

/** Stops `from` to `to` (1-based stop numbers, inclusive) of one day. */
export interface StopRange {
  day: number;
  from: number;
  to: number;
}

export interface FocusState {
  /** The day the map shows; null for the whole trip. */
  day: number | null;
  /** Picked stops within `day`; null when none are picked. */
  range: StopRange | null;
  /** A picked stay or flight (its id), when that's what the map is on instead of a day's stops. */
  spot: string | null;
  /** The map is shown, in view at the top of the itinerary while it scrolls; false when it's hidden. */
  docked: boolean;
}

/**
 * The next range after a stop is clicked. A first click picks that stop; a
 * click on another stop of the same day stretches the range to it, so "from
 * here to there" takes two clicks. Clicking an end of the range trims it,
 * clicking inside starts over from that stop, and clicking the only picked
 * stop again clears it.
 */
export function pickStop(cur: StopRange | null, day: number, order: number): StopRange | null {
  if (!cur || cur.day !== day) return { day, from: order, to: order };
  if (cur.from === cur.to) return order === cur.from ? null : { day, from: Math.min(cur.from, order), to: Math.max(cur.to, order) };
  if (order < cur.from) return { day, from: order, to: cur.to };
  if (order > cur.to) return { day, from: cur.from, to: order };
  if (order === cur.from) return { day, from: order + 1, to: cur.to };
  if (order === cur.to) return { day, from: cur.from, to: order - 1 };
  return { day, from: order, to: order };
}

export interface MapFocus {
  get: () => FocusState;
  subscribe: (listener: () => void) => () => void;
  /** Shows a day on the map (null for all), dropping any picked stops. */
  showDay: (day: number | null) => void;
  /** Picks stops; from the itinerary, the map docks so it stays in sight. */
  pick: (range: StopRange | null, opts?: { dock?: boolean }) => void;
  /** Picks a stay or a flight by id (dropping picked stops); `day` changes the day shown. */
  pickSpot: (id: string | null, opts?: { dock?: boolean; day?: number | null }) => void;
  setDocked: (docked: boolean) => void;
  /** Hovering a stop in one place lights it up in the other. Straight to the DOM: no re-render. */
  hover: (stopId: string | null) => void;
  /** The map registers each pin's element, so hovering a stop can light up its pin. A flight's two airports both register under its id. */
  registerPin: (stopId: string, el: HTMLElement) => () => void;
  /** Scrolls the itinerary to an activity and flashes it. */
  reveal: (stopId: string) => void;
}

export function createMapFocus(): MapFocus {
  let state: FocusState = { day: null, range: null, spot: null, docked: true };
  const listeners = new Set<() => void>();
  const pins = new Map<string, Set<HTMLElement>>();
  let hovered: string | null = null;

  const set = (next: Partial<FocusState>) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  const stopEls = (id: string) => document.querySelectorAll<HTMLElement>(`[data-stop="${CSS.escape(id)}"]`);
  const light = (id: string | null, on: boolean) => {
    if (!id) return;
    pins.get(id)?.forEach((el) => el.classList.toggle("hover", on));
    stopEls(id).forEach((el) => el.classList.toggle("map-hover", on));
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    showDay: (day) => set({ day, range: null, spot: null }),
    pick: (range, opts) => set({ range, spot: null, day: range ? range.day : state.day, docked: opts?.dock && range ? true : state.docked }),
    pickSpot: (spot, opts) =>
      set({ spot, range: null, day: opts?.day !== undefined ? opts.day : state.day, docked: opts?.dock && spot ? true : state.docked }),
    setDocked: (docked) => set({ docked }),
    hover: (id) => {
      light(hovered, false);
      hovered = id;
      light(id, true);
    },
    registerPin: (id, el) => {
      const set = pins.get(id) ?? new Set();
      pins.set(id, set.add(el));
      if (hovered === id) el.classList.add("hover");
      return () => {
        set.delete(el);
        if (!set.size && pins.get(id) === set) pins.delete(id);
      };
    },
    reveal: (id) => {
      const el = stopEls(id)[0];
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Days off screen skip rendering (content-visibility), so their heights are estimates and a
      // smooth scroll can stop short once they render. Settle it once the glide is over.
      setTimeout(() => {
        const box = el.getBoundingClientRect();
        const view = el.closest(".itinerary")?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
        if (box.bottom < view.top || box.top > view.bottom) el.scrollIntoView({ block: "center" });
      }, 700);
      el.classList.remove("flash");
      // Restart the animation even if it's already flashing.
      void el.offsetWidth;
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    },
  };
}

const MAP_HIDDEN_KEY = "planaway:map-hidden";

/** Remembers, in this browser, whether the map was hidden or shown again. */
export function rememberMapShown(shown: boolean) {
  try {
    if (shown) localStorage.removeItem(MAP_HIDDEN_KEY);
    else localStorage.setItem(MAP_HIDDEN_KEY, "1");
  } catch {}
}

/** The map starts shown; hide it if this browser hid it last time. Read after mount so the first render matches the server's. */
export function useRememberedMap(focus: MapFocus) {
  useEffect(() => {
    let hidden = false;
    try {
      hidden = localStorage.getItem(MAP_HIDDEN_KEY) === "1";
    } catch {}
    if (hidden) focus.setDocked(false);
  }, [focus]);
}

const FocusContext = createContext<MapFocus | null>(null);

export function MapFocusProvider({ value, children }: { value: MapFocus; children: ReactNode }) {
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/** The shared focus; without a provider (an itinerary shown on its own), each component keeps its own. */
export function useMapFocus(): MapFocus {
  const [own] = useState(createMapFocus);
  return useContext(FocusContext) ?? own;
}

/** Part of the focus state; re-renders only when the selected value changes (compare primitives). */
export function useFocusValue<T>(select: (s: FocusState) => T): T {
  const focus = useMapFocus();
  return useSyncExternalStore(
    focus.subscribe,
    () => select(focus.get()),
    () => select(focus.get()),
  );
}
