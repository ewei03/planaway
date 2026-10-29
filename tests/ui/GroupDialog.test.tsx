import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GroupDetail } from "@/components/client";
import { DialogProvider } from "@/components/Dialogs";
import { GroupDialog } from "@/components/GroupDialog";
import { me, mockFetch, sam } from "./fixtures";

const detail = (overrides: Partial<GroupDetail> = {}): GroupDetail => ({
  id: "g1",
  name: "Ski crew",
  personal: false,
  role: "owner",
  members: [
    { ...me, role: "owner" },
    { ...sam, email: "sam@example.com", role: "editor" },
  ],
  ...overrides,
});

function setup(group: GroupDetail, respond?: (url: string, init?: RequestInit) => unknown) {
  const fetch = mockFetch((url, init) => (respond?.(url, init) ?? (init?.method ? null : group)));
  const props = { onClose: vi.fn(), onChanged: vi.fn(), onGone: vi.fn(), onError: vi.fn() };
  render(
    <DialogProvider>
      <GroupDialog groupId="g1" user={me} {...props} />
    </DialogProvider>,
  );
  return { fetch, ...props };
}

describe("GroupDialog", () => {
  it("lets owners manage members", async () => {
    setup(detail());
    expect(await screen.findByRole("heading", { name: "Ski crew" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for Sam" })).toHaveValue("editor");
    expect(screen.getByRole("button", { name: "Remove Sam" })).toBeInTheDocument();
    // Owners can't remove themselves from here (they leave instead).
    expect(screen.queryByRole("button", { name: "Remove Maya" })).toBeNull();
    // Sharing is per trip now; the group dialog only points there.
    expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
    expect(screen.getByText(/choose Share… in the trip's ⋯ menu/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete group" })).toBeInTheDocument();
  });

  it("doesn't let owners change their own role", async () => {
    setup(detail());
    await screen.findByRole("heading", { name: "Ski crew" });
    expect(screen.queryByRole("combobox", { name: "Role for Maya" })).toBeNull();
    const myRow = screen.getByText("(you)").closest("li")!;
    expect(within(myRow).getByText("owner")).toHaveClass("role-badge");
  });

  it("transfers ownership after confirming", async () => {
    const { fetch, onChanged } = setup(detail());
    const transfer = await screen.findByRole("button", { name: "Transfer" });
    expect(transfer).toBeDisabled();
    // Only other members can be picked.
    const picker = screen.getByRole("combobox", { name: "New owner" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a member…", "Sam"]);

    await userEvent.selectOptions(picker, sam.id);
    await userEvent.click(transfer);
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    expect(within(confirm).getByText(/you'll become an editor/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: "Transfer" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = fetch.mock.calls.find(([url]) => url === "/api/groups/g1/transfer")!;
    expect(call[1]!.method).toBe("POST");
    expect(JSON.parse(call[1]!.body as string)).toEqual({ userId: sam.id });
  });

  it("hides the transfer control when there's nobody to transfer to", async () => {
    setup(detail({ members: [{ ...me, role: "owner" }] }));
    await screen.findByRole("heading", { name: "Ski crew" });
    expect(screen.queryByRole("heading", { name: "Transfer ownership" })).toBeNull();
  });

  it("shows a read-only view to non-owners", async () => {
    setup(detail({ role: "editor" }));
    await screen.findByRole("heading", { name: "Ski crew" });
    expect(screen.queryByRole("combobox", { name: /Role for/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Transfer ownership" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete group" })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave group" })).toBeInTheDocument();
  });

  it("changes a member's role", async () => {
    const { fetch, onChanged } = setup(detail());
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Role for Sam" }), "viewer");
    const call = fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(call[0]).toBe(`/api/groups/g1/members/${sam.id}`);
    expect(JSON.parse(call[1]!.body as string)).toEqual({ role: "viewer" });
    expect(onChanged).toHaveBeenCalled();
  });

  it("confirms before leaving, then reports the group is gone", async () => {
    const { fetch, onGone } = setup(detail());
    await userEvent.click(await screen.findByRole("button", { name: "Leave group" }));
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    await userEvent.click(within(confirm).getByRole("button", { name: "Leave" }));
    await vi.waitFor(() => expect(onGone).toHaveBeenCalled());
    expect(fetch.mock.calls.some(([url, init]) => url === `/api/groups/g1/members/${me.id}` && init?.method === "DELETE")).toBe(true);
  });

  it("closes with an error when the group can't be loaded", async () => {
    const { onError, onClose } = setup(detail(), () => Response.json({ error: "Group not found" }, { status: 404 }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Group not found"));
    expect(onClose).toHaveBeenCalled();
  });
});
