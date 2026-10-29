import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_SPLIT, MIN_SPLIT, SplitHandle } from "@/components/SplitHandle";

function setup(split = 0.5) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(<SplitHandle split={split} onChange={onChange} onReset={onReset} />);
  return { handle: screen.getByRole("separator", { name: "Resize chat and itinerary" }), onChange, onReset };
}

describe("SplitHandle", () => {
  it("reports its position", () => {
    expect(setup(0.44).handle).toHaveAttribute("aria-valuenow", "44");
  });

  it("resizes with the arrow keys, clamped to the limits", () => {
    const { handle, onChange } = setup(0.5);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(0.45);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(0.55);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(MIN_SPLIT);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(MAX_SPLIT);
  });

  it("never goes past the limits", () => {
    const { handle, onChange } = setup(MAX_SPLIT);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(MAX_SPLIT);
  });

  it("resets on double-click", () => {
    const { handle, onReset } = setup();
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalled();
  });
});
