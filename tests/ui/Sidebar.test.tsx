import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TripSummary } from "@/components/client";
import { Sidebar } from "@/components/Sidebar";
import { me } from "./fixtures";

const trip = { destinations: [] as string[], updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), hasItinerary: true, startDate: null, completedAt: null, role: "owner", sharedBy: null } as const;

const trips: TripSummary[] = [
  { ...trip, id: "t1", title: "Kyoto", destinations: ["Kyoto", "Nara"] },
  { ...trip, id: "t3", title: "Lisbon", role: "viewer", sharedBy: "Ana" },
  { ...trip, id: "t2", title: "Draft", hasItinerary: false },
  { ...trip, id: "t4", title: "Oslo", role: "editor", sharedBy: "Sam" },
];

function setupProps(overrides: Partial<ComponentProps<typeof Sidebar>> = {}): ComponentProps<typeof Sidebar> {
  return {
    user: me,
    trips,
    activeId: "t1",
    onSelect: vi.fn(),
    onNewTrip: vi.fn(),
    onRename: vi.fn(),
    onSaveVersion: vi.fn(),
    onExport: vi.fn(),
    onShare: vi.fn(),
    onComplete: vi.fn(),
    onDelete: vi.fn(),
    onLeave: vi.fn(),
    onSignOut: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props = setupProps(overrides);
  render(<Sidebar {...props} />);
  return props;
}

const openMenu = (title: string) => userEvent.click(screen.getByRole("button", { name: `Options for ${title}` }));
const menuItems = () => screen.getAllByRole("menuitem").map((m) => m.textContent);

describe("Sidebar", () => {
  it("lists your trips and trips shared with you, marking the active trip", () => {
    setup();
    const [mine, shared] = screen.getAllByRole("list").map((l) => within(l).getAllByRole("button", { name: /^(?!Options)/ }).map((b) => b.querySelector(".t-title")?.textContent));
    expect(mine).toEqual(["Kyoto", "Draft"]);
    expect(shared).toEqual(["Lisbon", "Oslo"]);
    expect(screen.getByRole("heading", { name: "Your trips" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shared with you" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Kyoto/ })).toHaveClass("active");
  });

  it("says when each trip was last updated", () => {
    setup();
    expect(screen.getByRole("button", { name: /^Kyoto/ })).toHaveTextContent("Updated 5 minutes ago");
    expect(screen.getByRole("button", { name: /^Oslo/ })).toHaveTextContent("Updated 5 minutes ago");
  });

  it("sorts by last update, newest first by default, and remembers the choice", async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const dated: TripSummary[] = [
      { ...trip, id: "a", title: "Old", updatedAt: ago(30) },
      { ...trip, id: "b", title: "New", updatedAt: ago(1) },
      { ...trip, id: "c", title: "Mid", updatedAt: ago(7) },
      { ...trip, id: "d", title: "Shared old", role: "viewer", sharedBy: "Sam", updatedAt: ago(20) },
      { ...trip, id: "e", title: "Shared new", role: "viewer", sharedBy: "Sam", updatedAt: ago(2) },
    ];
    const titles = () => [...document.querySelectorAll(".t-title")].map((t) => t.textContent);
    localStorage.removeItem("planaway:trip-sort");
    const { unmount } = render(<Sidebar {...setupProps({ trips: dated })} />);
    const select = screen.getByRole("combobox", { name: "Sort trips" });
    expect(select).toHaveValue("newest");
    expect(titles()).toEqual(["New", "Mid", "Old", "Shared new", "Shared old"]);

    await userEvent.selectOptions(select, "oldest");
    expect(titles()).toEqual(["Old", "Mid", "New", "Shared old", "Shared new"]);

    unmount();
    render(<Sidebar {...setupProps({ trips: dated })} />);
    expect(screen.getByRole("combobox", { name: "Sort trips" })).toHaveValue("oldest");
    localStorage.removeItem("planaway:trip-sort");
  });

  it("sorts by departure date, soonest first, with undated trips last, and says when each departs", async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const dated: TripSummary[] = [
      { ...trip, id: "a", title: "Undated old", updatedAt: ago(30) },
      { ...trip, id: "b", title: "June", startDate: "2027-06-10" },
      { ...trip, id: "c", title: "Undated new", updatedAt: ago(1) },
      { ...trip, id: "d", title: "March", startDate: "2027-03-04" },
    ];
    const titles = () => [...document.querySelectorAll(".t-title")].map((t) => t.textContent);
    localStorage.removeItem("planaway:trip-sort");
    render(<Sidebar {...setupProps({ trips: dated })} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort trips" }), "departure");
    expect(titles()).toEqual(["March", "June", "Undated new", "Undated old"]);
    expect(screen.getByRole("button", { name: /^March/ })).toHaveTextContent(/Departs Mar 4, 2027/);
    expect(screen.getByRole("button", { name: /^Undated new/ })).toHaveTextContent("Updated yesterday");
    localStorage.removeItem("planaway:trip-sort");
  });

  it("puts completed trips, yours and shared, in their own section", async () => {
    const done = "2026-10-01T00:00:00.000Z";
    const props = setup({ trips: [...trips, { ...trip, id: "t5", title: "Paris", completedAt: done }, { ...trip, id: "t6", title: "Rome", role: "editor", sharedBy: "Sam", completedAt: done }] });
    const section = screen.getByRole("heading", { name: "Completed trips" }).closest("section")!;
    expect([...section.querySelectorAll(".t-title")].map((t) => t.textContent)).toEqual(["Paris", "Rome"]);
    expect(screen.getAllByRole("list")[0]).not.toHaveTextContent("Paris");

    await openMenu("Paris");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move out of Completed" }));
    expect(props.onComplete).toHaveBeenCalledWith("t5", false);
    await openMenu("Kyoto");
    await userEvent.click(screen.getByRole("menuitem", { name: "Mark as completed" }));
    expect(props.onComplete).toHaveBeenCalledWith("t1", true);
  });

  it("hides the Completed section when nothing is completed", () => {
    setup();
    expect(screen.queryByRole("heading", { name: "Completed trips" })).not.toBeInTheDocument();
  });

  it("shows each trip's destination photo, or its initial without one", () => {
    const photo = { src: "big.jpg", thumb: "kyoto-thumb.jpg", author: "Aiko", license: "CC BY 4.0", sourceUrl: null };
    const place = { id: "node/1", name: "Kyoto", address: null, lat: 0, lng: 0, mapsUrl: null, photos: [photo] };
    const { container } = render(
      <Sidebar {...setupProps({ trips: [{ ...trip, id: "k", title: "Kyoto", destinations: ["Kyoto"] }, { ...trip, id: "d", title: "draft" }], lookup: (q) => (q.endsWith("Kyoto") ? place : null) })} />,
    );
    const thumbs = container.querySelectorAll(".t-thumb");
    expect(thumbs[0].querySelector("img")).toHaveAttribute("src", "kyoto-thumb.jpg");
    expect(thumbs[0]).toHaveAttribute("title", "Photo: Aiko, CC BY 4.0");
    expect(thumbs[1]).toHaveTextContent("D");
  });

  it("shows an empty state when you have no trips of your own", () => {
    setup({ trips: trips.filter((t) => t.role !== "owner") });
    expect(screen.getByText("No trips yet.")).toBeInTheDocument();
  });

  it("opens a trip menu with share, save, export, and delete", async () => {
    const props = setup();
    await openMenu("Kyoto");
    expect(menuItems()).toEqual(["Rename…", "Share…", "Save version…", "Export as…›", "Mark as completed", "Delete trip…"]);

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
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    expect(props.onRename).toHaveBeenCalledWith("t1");

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

  it("lets editors of a shared trip rename, save, export, or leave it, but not share or delete it", async () => {
    const props = setup();
    await openMenu("Oslo");
    expect(menuItems()).toEqual(["Rename…", "Save version…", "Export as…›", "Mark as completed", "Leave trip…"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Leave trip…" }));
    expect(props.onLeave).toHaveBeenCalledWith("t4");
  });

  it("hides the shared section when nothing is shared with you", () => {
    setup({ trips: trips.filter((t) => t.role === "owner") });
    expect(screen.queryByRole("heading", { name: "Shared with you" })).toBeNull();
  });

  it("disables saving and exporting a trip with no itinerary yet", async () => {
    setup();
    await openMenu("Draft");
    expect(screen.getByRole("menuitem", { name: "Save version…" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Export as/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Delete trip…" })).toBeEnabled();
  });

  it("only lets viewers export or leave", async () => {
    setup();
    await openMenu("Lisbon");
    expect(menuItems()).toEqual(["Export as…›", "Leave trip…"]);
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
    await userEvent.click(screen.getByRole("button", { name: "New trip" }));
    expect(props.onNewTrip).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(props.onSignOut).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Hide trips" }));
    expect(props.onHide).toHaveBeenCalled();
  });
});
