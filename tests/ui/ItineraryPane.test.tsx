import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { DialogProvider } from "@/components/Dialogs";
import { ItineraryPane } from "@/components/ItineraryPane";
import { sampleItinerary } from "../fixtures";
import { commentView, me, tripView } from "./fixtures";

function setup(overrides: Partial<ComponentProps<typeof ItineraryPane>> = {}) {
  const props: ComponentProps<typeof ItineraryPane> = {
    trip: tripView(),
    user: me,
    viewing: "current",
    working: false,
    onView: vi.fn(),
    onSaveVersion: vi.fn(),
    onExport: vi.fn(),
    onBack: vi.fn(),
    onChanged: vi.fn(),
    onAskAgent: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  const view = render(
    <DialogProvider>
      <ItineraryPane {...props} />
    </DialogProvider>,
  );
  return { props, view };
}

const version = { id: "v1", label: "First draft", savedAt: "2026-10-01T10:00:00Z", savedBy: me.id, itinerary: { ...sampleItinerary(), title: "Old plan" } };

describe("ItineraryPane", () => {
  it("shows an empty state that depends on whether the agent is working", () => {
    const { view } = setup({ trip: tripView({ itinerary: null }) });
    expect(screen.getByText(/No itinerary yet/)).toBeInTheDocument();
    view.unmount();
    setup({ trip: tripView({ itinerary: null }), working: true });
    expect(screen.getByText(/Researching your trip/)).toBeInTheDocument();
  });

  it("shows a saved version", () => {
    setup({ trip: tripView({ versions: [version] }), viewing: "v1" });
    expect(screen.getByRole("heading", { name: "Old plan" })).toBeInTheDocument();
  });

  it("saves the current draft from the toolbar", async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSaveVersion).toHaveBeenCalled();
    // Delete stays in the sidebar's trip menu.
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("disables Save while viewing an old version or before there's an itinerary", () => {
    const { view } = setup({ trip: tripView({ versions: [version] }), viewing: "v1" });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    view.unmount();
    setup({ trip: tripView({ itinerary: null }) });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export ▾" })).toBeDisabled();
  });

  it("exports from the toolbar menu", async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Export ▾" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Spreadsheet (.csv)",
      "Document (.md)",
      "Calendar (.ics)",
      "Data (.json)",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Calendar (.ics)" }));
    expect(props.onExport).toHaveBeenCalledWith("ics");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the export menu on an outside click or Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Export ▾" }));
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Export ▾" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lets viewers export but not save", () => {
    setup({ trip: tripView({ role: "viewer", canDelete: false, canShare: false }) });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export ▾" })).toBeEnabled();
  });

  it("switches versions from the menu", async () => {
    const { props } = setup({ trip: tripView({ versions: [version] }) });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Itinerary version" }), "v1");
    expect(props.onView).toHaveBeenCalledWith("v1");
  });

  it("shows who else is viewing in the toolbar", () => {
    setup({ viewers: [{ id: "u-sam", name: "Sam" }] });
    expect(screen.getByRole("group", { name: "Also viewing: Sam" })).toBeInTheDocument();
  });

  it("counts open comment threads and opens the panel on an item", async () => {
    const comments = [
      commentView(),
      commentView({ targetType: "day", targetId: "d2" }),
      commentView({ resolvedAt: "2026-10-01T00:00:00Z" }),
    ];
    comments.push(commentView({ parentId: comments[0].id }));
    setup({ trip: tripView({ comments }) });
    expect(screen.getByRole("button", { name: "💬 2" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "1 comments on Day 1 · Nishiki Market" }));
    expect(screen.getByRole("complementary", { name: "Comments" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close comments" }));
    expect(screen.queryByRole("complementary", { name: "Comments" })).toBeNull();
  });
});
