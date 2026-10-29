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
  invites: [{ token: "tok123", role: "viewer", expiresAt: "2026-11-04T00:00:00Z" }],
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
  it("lets owners manage members and invites", async () => {
    setup(detail());
    expect(await screen.findByRole("heading", { name: "Ski crew" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for Sam" })).toHaveValue("editor");
    expect(screen.getByRole("button", { name: "Remove Sam" })).toBeInTheDocument();
    // Owners can't remove themselves from here (they leave instead).
    expect(screen.queryByRole("button", { name: "Remove Maya" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(`${location.origin}/invite/tok123`);
    expect(screen.getByRole("button", { name: "Delete group" })).toBeInTheDocument();
  });

  it("shows a read-only view to non-owners", async () => {
    setup(detail({ role: "editor", invites: [] }));
    await screen.findByRole("heading", { name: "Ski crew" });
    expect(screen.queryByRole("combobox", { name: /Role for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create invite link" })).toBeNull();
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

  it("creates an invite at the chosen role and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { fetch } = setup(detail(), (url, init) => (init?.method === "POST" ? { token: "new-token" } : undefined));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Invite role" }), "viewer");
    await userEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    const call = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ role: "viewer" });
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/invite/new-token`));
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
