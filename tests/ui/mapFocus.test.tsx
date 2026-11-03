import { describe, expect, it, vi } from "vitest";
import { createMapFocus, pickStop } from "@/components/mapFocus";

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
  it("shows the picked stops' day, and docks only when asked", () => {
    const focus = createMapFocus();
    const listener = vi.fn();
    focus.subscribe(listener);
    focus.pick({ day: 2, from: 1, to: 3 });
    expect(focus.get()).toEqual({ day: 2, range: { day: 2, from: 1, to: 3 }, docked: false });
    focus.pick({ day: 2, from: 1, to: 1 }, { dock: true });
    expect(focus.get().docked).toBe(true);
    // Clearing keeps the day and the dock.
    focus.pick(null, { dock: true });
    expect(focus.get()).toEqual({ day: 2, range: null, docked: true });
    focus.showDay(null);
    expect(focus.get().day).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
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
