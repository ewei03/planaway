import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GroupSummary, SharedTripSummary } from "@/components/client";
import { Sidebar } from "@/components/Sidebar";
import { me } from "./fixtures";

const trip = { groupId: "p", destinations: [], updatedAt: "2026-10-01T00:00:00Z", hasItinerary: true, canDelete: true, canShare: true };

const groups: GroupSummary[] = [
  {
    id: "p",
    name: "Personal",
    personal: true,
    role: "owner",
    memberCount: 1,
    trips: [
      { ...trip, id: "t1", title: "Kyoto", destinations: ["Kyoto", "Nara", "Osaka", "Kobe"] },
      { ...trip, id: "t2", title: "Draft", hasItinerary: false },
    ],
  },
  { id: "v", name: "Family", personal: false, role: "viewer", memberCount: 4, trips: [{ ...trip, id: "t3", groupId: "v", title: "Lisbon", canDelete: false, canShare: false }] },
];

const shared: SharedTripSummary[] = [
  { ...trip, id: "t4", groupId: "x", title: "Oslo", role: "viewer", sharedBy: "Sam", canDelete: false, canShare: false },
];

function setup(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props: ComponentProps<typeof Sidebar> = {
    user: me,
    groups,
    shared,
    activeId: "t1",
    onSelect: vi.fn(),
    onNewTrip: vi.fn(),
    onNewGroup: vi.fn(),
    onManageGroup: vi.fn(),
    onSaveVersion: vi.fn(),
    onExport: vi.fn(),
    onShare: vi.fn(),
    onDelete: vi.fn(),
    onLeave: vi.fn(),
    onSignOut: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

const openMenu = (title: string) => userEvent.click(screen.getByRole("button", { name: `Options for ${title}` }));
const menuItems = () => screen.getAllByRole("menuitem").map((m) => m.textContent);

describe("Sidebar", () => {
  it("lists groups and trips, marking the active trip", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Personal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Family · 4" })).toBeInTheDocument();
    const active = screen.getByRole("button", { name: /^Kyoto/ });
    expect(active).toHaveClass("active");
    expect(active).toHaveTextContent("Kyoto, Nara, Osaka");
    expect(active).not.toHaveTextContent("Kobe");
  });

  it("shows an empty state for a group with no trips", () => {
    setup({ groups: [{ ...groups[0], trips: [] }] });
    expect(screen.getByText("No trips yet.")).toBeInTheDocument();
  });

  it("only offers new trips in shared groups you can edit, and settings for shared groups", () => {
    setup();
    expect(screen.queryByRole("button", { name: "New trip in Personal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New trip in Family" })).toBeNull();
    expect(screen.getByRole("button", { name: "Manage Family" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage Personal" })).toBeNull();
  });

  it("opens a trip menu with share, save, export, and delete", async () => {
    const props = setup();
    await openMenu("Kyoto");
    expect(menuItems()).toEqual(["Share…", "Save version…", "Export as…›", "Delete trip…"]);

    await userEvent.hover(screen.getByRole("menuitem", { name: /Export as/ }));
    const formats = screen.getByRole("menu", { name: "Export as" });
    expect(within(formats).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Spreadsheet (.csv)",
      "Document (.md)",
      "Calendar (.ics)",
      "Data (.json)",
    ]);
    await userEvent.unhover(screen.getByRole("menuitem", { name: /Export as/ }));
    expect(screen.queryByRole("menu", { name: "Export as" })).toBeNull();

    await userEvent.hover(screen.getByRole("menuitem", { name: /Export as/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Calendar (.ics)" }));
    expect(props.onExport).toHaveBeenCalledWith("t1", "ics");
    expect(screen.queryByRole("menu")).toBeNull();

    await openMenu("Kyoto");
    await userEvent.click(screen.getByRole("menuitem", { name: "Share…" }));
    expect(props.onShare).toHaveBeenCalledWith("t1");

    await openMenu("Kyoto");
    await userEvent.click(screen.getByRole("menuitem", { name: "Save version…" }));
    expect(props.onSaveVersion).toHaveBeenCalledWith("t1");

    await openMenu("Kyoto");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete trip…" }));
    expect(props.onDelete).toHaveBeenCalledWith("t1");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("lists trips shared with you, which you can export or leave but not share or delete", async () => {
    const props = setup();
    expect(screen.getByRole("heading", { name: "Shared with you" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Oslo/ })).toHaveTextContent("From Sam");
    await openMenu("Oslo");
    expect(menuItems()).toEqual(["Export as…›", "Leave trip…"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Leave trip…" }));
    expect(props.onLeave).toHaveBeenCalledWith("t4");
  });

  it("hides the shared section when nothing is shared with you", () => {
    setup({ shared: [] });
    expect(screen.queryByRole("heading", { name: "Shared with you" })).toBeNull();
  });

  it("disables saving and exporting a trip with no itinerary yet", async () => {
    setup();
    await openMenu("Draft");
    expect(screen.getByRole("menuitem", { name: "Save version…" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Export as/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Delete trip…" })).toBeEnabled();
  });

  it("only lets viewers export", async () => {
    setup();
    await openMenu("Lisbon");
    expect(menuItems()).toEqual(["Export as…›"]);
  });

  it("opens the export submenu with a click or the keyboard", async () => {
    setup();
    await openMenu("Kyoto");
    const exportItem = screen.getByRole("menuitem", { name: /Export as/ });
    // Touch screens have no hover: a tap opens it.
    await userEvent.click(exportItem);
    expect(screen.getByRole("menu", { name: "Export as" })).toBeInTheDocument();

    await userEvent.unhover(exportItem);
    exportItem.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("menuitem", { name: "Spreadsheet (.csv)" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("menu", { name: "Export as" })).toBeNull();
    expect(exportItem).toHaveFocus();
  });

  it("closes the trip menu on an outside click or Escape", async () => {
    setup();
    await openMenu("Kyoto");
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await openMenu("Kyoto");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("wires up the actions", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Kyoto/ }));
    expect(props.onSelect).toHaveBeenCalledWith("t1");
    await userEvent.click(screen.getByRole("button", { name: "+ New trip" }));
    expect(props.onNewTrip).toHaveBeenCalledWith("p");
    await userEvent.click(screen.getByRole("button", { name: "Manage Family" }));
    expect(props.onManageGroup).toHaveBeenCalledWith("v");
    await userEvent.click(screen.getByRole("button", { name: "+ New group" }));
    expect(props.onNewGroup).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(props.onSignOut).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Hide trips" }));
    expect(props.onHide).toHaveBeenCalled();
  });
});
