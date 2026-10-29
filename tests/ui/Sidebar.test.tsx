import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GroupSummary } from "@/components/client";
import { Sidebar } from "@/components/Sidebar";
import { me } from "./fixtures";

const groups: GroupSummary[] = [
  {
    id: "p",
    name: "Personal",
    personal: true,
    role: "owner",
    memberCount: 1,
    trips: [{ id: "t1", groupId: "p", title: "Kyoto", destinations: ["Kyoto", "Nara", "Osaka", "Kobe"], updatedAt: "2026-10-01T00:00:00Z" }],
  },
  { id: "v", name: "Family", personal: false, role: "viewer", memberCount: 4, trips: [] },
];

function setup() {
  const props: ComponentProps<typeof Sidebar> = {
    user: me,
    groups,
    activeId: "t1",
    onSelect: vi.fn(),
    onNewTrip: vi.fn(),
    onNewGroup: vi.fn(),
    onManageGroup: vi.fn(),
    onSignOut: vi.fn(),
    onHide: vi.fn(),
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar", () => {
  it("lists groups and trips, marking the active trip", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Personal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Family · 4" })).toBeInTheDocument();
    const trip = screen.getByRole("button", { name: /Kyoto/ });
    expect(trip).toHaveClass("active");
    expect(trip).toHaveTextContent("Kyoto, Nara, Osaka");
    expect(trip).not.toHaveTextContent("Kobe");
    expect(screen.getByText("No trips yet.")).toBeInTheDocument();
  });

  it("only offers new trips in shared groups you can edit, and settings for shared groups", () => {
    setup();
    expect(screen.queryByRole("button", { name: "New trip in Personal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New trip in Family" })).toBeNull();
    expect(screen.getByRole("button", { name: "Manage Family" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage Personal" })).toBeNull();
  });

  it("wires up the actions", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /Kyoto/ }));
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
