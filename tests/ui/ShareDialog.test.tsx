import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TripSharing } from "@/components/client";
import { DialogProvider } from "@/components/Dialogs";
import { ShareDialog } from "@/components/ShareDialog";
import { mockFetch, sam } from "./fixtures";

const TRIP = "11111111-1111-1111-1111-111111111111";

const sharing = (overrides: Partial<TripSharing> = {}): TripSharing => ({
  invites: [{ token: "tok123", role: "viewer", expiresAt: "2026-11-05T00:00:00Z" }],
  members: [{ ...sam, email: "sam@example.com", role: "viewer" }],
  ...overrides,
});

function setup(data: TripSharing, { groupName = null as string | null, respond = undefined as ((url: string, init?: RequestInit) => unknown) | undefined } = {}) {
  const fetch = mockFetch((url, init) => respond?.(url, init) ?? (init?.method ? null : data));
  const props = { onClose: vi.fn(), onError: vi.fn() };
  render(
    <DialogProvider>
      <ShareDialog tripId={TRIP} tripTitle="Kyoto" groupName={groupName} {...props} />
    </DialogProvider>,
  );
  return { fetch, ...props };
}

const clipboard = () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

describe("ShareDialog", () => {
  it("lists links and the people who joined through them", async () => {
    setup(sharing(), { groupName: "Ski crew" });
    expect(await screen.findByRole("heading", { name: "Share “Kyoto”" })).toBeInTheDocument();
    const link = screen.getByRole("textbox", { name: "Invite link" });
    expect(link).toHaveValue(`${location.origin}/invite/tok123`);
    // Role and expiry stay out of the way, in the link's tooltip.
    expect(link).toHaveAttribute("title", expect.stringMatching(/^Can view · expires /));
    expect(screen.getByRole("combobox", { name: "Role for Sam" })).toHaveValue("viewer");
    expect(screen.getByText(/gives access to this trip only/)).toBeInTheDocument();
    expect(screen.getByText("Everyone in Ski crew can also see this trip.")).toBeInTheDocument();
  });

  it("explains when nobody has joined, and skips the group note for personal trips", async () => {
    setup(sharing({ invites: [], members: [] }));
    expect(await screen.findByText("Nobody has joined through a link yet.")).toBeInTheDocument();
    expect(screen.queryByText(/can also see this trip/)).toBeNull();
  });

  it("creates a link with the chosen role and expiry, and copies it", async () => {
    const writeText = clipboard();
    const { fetch } = setup(sharing({ invites: [] }), {
      respond: (_url, init) => (init?.method === "POST" ? { token: "new-token", expiresAt: null } : undefined),
    });
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Invite role" }), "editor");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Link expiry" }), "never");
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    const call = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(call[0]).toBe(`/api/trips/${TRIP}/invites`);
    expect(JSON.parse(call[1]!.body as string)).toEqual({ role: "editor", expiresInDays: null });
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/invite/new-token`));
  });

  it("defaults to view-only links that expire in a week", async () => {
    const { fetch } = setup(sharing({ invites: [] }), { respond: (_url, init) => (init?.method === "POST" ? { token: "t" } : undefined) });
    await userEvent.click(await screen.findByRole("button", { name: "Create link" }));
    const call = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ role: "viewer", expiresInDays: 7 });
  });

  it("copies an existing link with the copy icon", async () => {
    const writeText = clipboard();
    setup(sharing());
    await userEvent.click(await screen.findByRole("button", { name: "Copy invite link" }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/invite/tok123`);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("revokes links, changes roles, and removes people", async () => {
    const { fetch } = setup(sharing());
    await userEvent.click(await screen.findByRole("button", { name: "Revoke invite" }));
    expect(fetch.mock.calls.some(([url, init]) => url === `/api/trips/${TRIP}/invites/tok123` && init?.method === "DELETE")).toBe(true);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Sam" }), "editor");
    const patch = fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe(`/api/trips/${TRIP}/members/${sam.id}`);
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ role: "editor" });

    await userEvent.click(screen.getByRole("button", { name: "Remove Sam" }));
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([url, init]) => url === `/api/trips/${TRIP}/members/${sam.id}` && init?.method === "DELETE")).toBe(true),
    );
  });

  it("reports a load failure and closes", async () => {
    mockFetch(() => Response.json({ error: "Only the trip's creator or a group owner can share it." }, { status: 403 }));
    const onClose = vi.fn();
    const onError = vi.fn();
    render(
      <DialogProvider>
        <ShareDialog tripId={TRIP} tripTitle="Kyoto" groupName={null} onClose={onClose} onError={onError} />
      </DialogProvider>,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Only the trip's creator or a group owner can share it."));
    expect(onClose).toHaveBeenCalled();
  });
});
