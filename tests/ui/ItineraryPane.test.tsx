import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { DialogProvider } from "@/components/Dialogs";
import { ItineraryPane } from "@/components/ItineraryPane";
import { sampleItinerary } from "../fixtures";
import { commentView, me, mockFetch, tripView } from "./fixtures";

function setup(overrides: Partial<ComponentProps<typeof ItineraryPane>> = {}) {
  const props: ComponentProps<typeof ItineraryPane> = {
    trip: tripView(),
    user: me,
    viewing: "current",
    working: false,
    onView: vi.fn(),
    onSaveVersion: vi.fn(),
    onDelete: vi.fn(),
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
    expect(screen.getByRole("button", { name: "Export ▾" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    view.unmount();
    setup({ trip: tripView({ itinerary: null }), working: true });
    expect(screen.getByText(/Researching your trip/)).toBeInTheDocument();
  });

  it("shows a saved version and disables saving while viewing it", () => {
    setup({ trip: tripView({ versions: [version] }), viewing: "v1" });
    expect(screen.getByRole("heading", { name: "Old plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("switches versions from the menu", async () => {
    const { props } = setup({ trip: tripView({ versions: [version] }) });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Itinerary version" }), "v1");
    expect(props.onView).toHaveBeenCalledWith("v1");
  });

  it("exports the version being viewed", async () => {
    const fetch = mockFetch(() => new Response("x"));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setup({ trip: tripView({ versions: [version] }), viewing: "v1" });
    await userEvent.click(screen.getByRole("button", { name: "Export ▾" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Spreadsheet (.csv)",
      "Document (.md)",
      "Calendar (.ics)",
      "Data (.json)",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Calendar (.ics)" }));
    expect(fetch.mock.calls[0][0]).toBe(`/api/trips/${tripView().id}/export?format=ics&version=v1`);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("reports export errors", async () => {
    mockFetch(() => Response.json({ error: "This itinerary has no dates yet." }, { status: 422 }));
    const { props } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Export ▾" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Calendar (.ics)" }));
    await vi.waitFor(() => expect(props.onError).toHaveBeenCalledWith("This itinerary has no dates yet."));
  });

  it("closes the export menu on an outside click", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Export ▾" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("hides editor-only actions from viewers", () => {
    setup({ trip: tripView({ role: "viewer", canDelete: false }) });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export ▾" })).toBeEnabled();
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
