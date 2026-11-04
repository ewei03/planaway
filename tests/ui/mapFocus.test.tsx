import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createMapFocus, pickStop, rememberMapShown, useRememberedMap } from "@/components/mapFocus";

describe("pickStop", () => {
  const r = (from: number, to: number, day = 1) => ({ day, from, to });

  it("picks a stop, then stretches to a second one either way", () => {
    expect(pickStop(null, 1, 2)).toEqual(r(2, 2));
    expect(pickStop(r(2, 2), 1, 4)).toEqual(r(2, 4));
    expect(pickStop(r(2, 2), 1, 1)).toEqual(r(1, 2));
  });

  it("lets go of the only picked stop when it's clicked again", () => {
    expect(pickStop(r(3, 3), 1, 3)).toBeNull();
  });

  it("grows past either end, trims an end, and starts over from inside", () => {
    expect(pickStop(r(2, 4), 1, 6)).toEqual(r(2, 6));
    expect(pickStop(r(2, 4), 1, 1)).toEqual(r(1, 4));
    expect(pickStop(r(2, 4), 1, 2)).toEqual(r(3, 4));
    expect(pickStop(r(2, 4), 1, 4)).toEqual(r(2, 3));
    expect(pickStop(r(2, 5), 1, 3)).toEqual(r(3, 3));
  });

  it("starts over on another day", () => {
    expect(pickStop(r(2, 4), 2, 3)).toEqual(r(3, 3, 2));
  });
});

describe("createMapFocus", () => {
  it("starts with the map shown, and brings a hidden map back only when asked", () => {
    const focus = createMapFocus();
    expect(focus.get()).toEqual({ day: null, range: null, spot: null, docked: true });
    const listener = vi.fn();
    focus.subscribe(listener);
    focus.setDocked(false);
    focus.pick({ day: 2, from: 1, to: 3 });
    expect(focus.get()).toEqual({ day: 2, range: { day: 2, from: 1, to: 3 }, spot: null, docked: false });
    focus.pick({ day: 2, from: 1, to: 1 }, { dock: true });
    expect(focus.get().docked).toBe(true);
    // Clearing keeps the day and the map.
    focus.pick(null, { dock: true });
    expect(focus.get()).toEqual({ day: 2, range: null, spot: null, docked: true });
    focus.showDay(null);
    expect(focus.get().day).toBeNull();
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("remembers a hidden map in this browser", () => {
    rememberMapShown(false);
    const hidden = createMapFocus();
    renderHook(() => useRememberedMap(hidden));
    expect(hidden.get().docked).toBe(false);
    rememberMapShown(true);
    const shown = createMapFocus();
    renderHook(() => useRememberedMap(shown));
    expect(shown.get().docked).toBe(true);
  });

  it("picks a stay or flight instead of stops, and the other way round", () => {
    const focus = createMapFocus();
    focus.setDocked(false);
    focus.pick({ day: 1, from: 2, to: 2 });
    focus.pickSpot("l1", { dock: true });
    expect(focus.get()).toEqual({ day: 1, range: null, spot: "l1", docked: true });
    focus.pickSpot("f1", { day: null });
    expect(focus.get().day).toBeNull();
    focus.pick({ day: 2, from: 1, to: 1 });
    expect(focus.get().spot).toBeNull();
    focus.pickSpot("l1");
    focus.showDay(1);
    expect(focus.get().spot).toBeNull();
  });

  it("lights up every pin registered under an id, such as a flight's two airports", () => {
    const focus = createMapFocus();
    const [from, to] = [document.createElement("div"), document.createElement("div")];
    focus.registerPin("f1", from);
    const unregister = focus.registerPin("f1", to);
    focus.hover("f1");
    expect(from).toHaveClass("hover");
    expect(to).toHaveClass("hover");
    focus.hover(null);
    unregister();
    focus.hover("f1");
    expect(from).toHaveClass("hover");
    expect(to).not.toHaveClass("hover");
  });

  it("lights up the hovered stop's pin and cards, and only that one", () => {
    const focus = createMapFocus();
    document.body.innerHTML = '<li data-stop="a1"></li><li data-stop="a2"></li>';
    const pin = document.createElement("div");
    const unregister = focus.registerPin("a1", pin);
    focus.hover("a1");
    expect(pin).toHaveClass("hover");
    expect(document.querySelector('[data-stop="a1"]')).toHaveClass("map-hover");
    focus.hover("a2");
    expect(pin).not.toHaveClass("hover");
    expect(document.querySelector('[data-stop="a1"]')).not.toHaveClass("map-hover");
    expect(document.querySelector('[data-stop="a2"]')).toHaveClass("map-hover");
    unregister();
    focus.hover("a1");
    expect(pin).not.toHaveClass("hover");
  });

  it("scrolls to a stop in the itinerary and flashes it", () => {
    const focus = createMapFocus();
    document.body.innerHTML = '<li data-stop="a3"></li>';
    const el = document.querySelector<HTMLElement>('[data-stop="a3"]')!;
    el.scrollIntoView = vi.fn();
    focus.reveal("a3");
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(el).toHaveClass("flash");
    focus.reveal("missing");
  });
});
