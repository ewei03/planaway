import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SIDEBAR, MAX_CHAT, MAX_SIDEBAR, MIN_CHAT, MIN_SIDEBAR, SidebarHandle, SplitHandle } from "@/components/SplitHandle";

describe("SidebarHandle", () => {
  it("resizes with the keyboard within its limits, and double-click resets it", () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(<SidebarHandle width={DEFAULT_SIDEBAR} onChange={onChange} onReset={onReset} />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_SIDEBAR));

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_SIDEBAR + 20);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(MAX_SIDEBAR);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(MIN_SIDEBAR);
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalled();
  });

  it("never goes past its limits", () => {
    const onChange = vi.fn();
    render(<SidebarHandle width={MAX_SIDEBAR} onChange={onChange} onReset={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(MAX_SIDEBAR);
  });
});

describe("SplitHandle", () => {
  it("keeps the chat between its limits", () => {
    const onChange = vi.fn();
    render(<SplitHandle width={MIN_CHAT} onChange={onChange} onReset={vi.fn()} />);
    const handle = screen.getByRole("separator", { name: "Resize chat and itinerary" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(MIN_CHAT);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(MAX_CHAT);
  });
});
