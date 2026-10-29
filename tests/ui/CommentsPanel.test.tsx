import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CommentAnchor } from "@/components/client";
import { CommentsPanel } from "@/components/CommentsPanel";
import { DialogProvider } from "@/components/Dialogs";
import { commentView, me, mockFetch, sam, tripView } from "./fixtures";

function setup(overrides: Partial<ComponentProps<typeof CommentsPanel>> = {}) {
  const props: ComponentProps<typeof CommentsPanel> = {
    trip: tripView(),
    user: me,
    anchor: null,
    onAnchor: vi.fn(),
    onClose: vi.fn(),
    onChanged: vi.fn(),
    onAskAgent: vi.fn(),
    agentBusy: false,
    onError: vi.fn(),
    ...overrides,
  };
  render(
    <DialogProvider>
      <CommentsPanel {...props} />
    </DialogProvider>,
  );
  return props;
}

const nishiki: CommentAnchor = { type: "activity", id: "a1", label: "Day 1 · Nishiki Market" };

describe("CommentsPanel", () => {
  it("filters threads by open and resolved", async () => {
    const open = commentView({ body: "Too pricey?" });
    const done = commentView({ body: "Book early", resolvedAt: new Date().toISOString(), resolvedBy: sam.id });
    setup({ trip: tripView({ comments: [open, done] }) });
    expect(screen.getByText("Too pricey?")).toBeInTheDocument();
    expect(screen.queryByText("Book early")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Resolved (1)" }));
    expect(screen.getByText("Book early")).toBeInTheDocument();
    expect(screen.queryByText("Too pricey?")).toBeNull();
  });

  it("groups replies under their thread and labels agent replies", () => {
    const root = commentView({ body: "Vegetarian options?" });
    const reply = commentView({ parentId: root.id, author: null, body: "Added Shigetsu for lunch." });
    setup({ trip: tripView({ comments: [root, reply] }) });
    expect(screen.getAllByText(/Vegetarian|Shigetsu/)).toHaveLength(2);
    expect(screen.getByText("✨ PlanAway")).toHaveClass("agent");
  });

  it("flags threads whose item was removed from the plan", () => {
    setup({ trip: tripView({ comments: [commentView({ targetId: "gone", targetLabel: "Old dinner" })] }) });
    expect(screen.getByRole("button", { name: /Old dinner/ })).toHaveTextContent("(removed from plan)");
  });

  it("starts a thread on an anchor", async () => {
    const fetch = mockFetch(() => null);
    const { onChanged } = setup({ anchor: nishiki });
    expect(screen.getByText("Day 1 · Nishiki Market")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Comment" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/Too pricey/), "Can we go earlier?");
    await userEvent.click(button);
    expect(fetch).toHaveBeenCalledWith(
      `/api/trips/${tripView().id}/comments`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
      body: "Can we go earlier?",
      targetType: "activity",
      targetId: "a1",
      targetLabel: "Day 1 · Nishiki Market",
    });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/Too pricey/)).toHaveValue("");
  });

  it("keeps the draft and reports errors when posting fails", async () => {
    mockFetch(() => Response.json({ error: "Trip not found" }, { status: 404 }));
    const { onError } = setup({ anchor: nishiki });
    await userEvent.type(screen.getByPlaceholderText(/Too pricey/), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(onError).toHaveBeenCalledWith("Trip not found");
    expect(screen.getByPlaceholderText(/Too pricey/)).toHaveValue("Hello");
  });

  it("shows only the anchor's threads when focused", () => {
    setup({
      anchor: nishiki,
      trip: tripView({ comments: [commentView({ body: "Here" }), commentView({ targetType: "day", targetId: "d1", body: "Elsewhere" })] }),
    });
    expect(screen.getByText("Here")).toBeInTheDocument();
    expect(screen.queryByText("Elsewhere")).toBeNull();
  });

  it("replies to a thread", async () => {
    const fetch = mockFetch(() => null);
    const root = commentView();
    setup({ trip: tripView({ comments: [root] }) });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    await userEvent.type(screen.getByPlaceholderText("Reply…"), "Agreed");
    await userEvent.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ parentId: root.id, body: "Agreed" });
    expect(screen.queryByPlaceholderText("Reply…")).toBeNull();
  });

  it("resolves and reopens threads", async () => {
    const fetch = mockFetch(() => null);
    const root = commentView();
    setup({ trip: tripView({ comments: [root] }) });
    await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(fetch).toHaveBeenCalledWith(`/api/trips/${tripView().id}/comments/${root.id}`, expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ resolved: true });
  });

  it("only lets viewers resolve their own threads", () => {
    const mine = commentView({ author: { id: me.id, name: me.name }, body: "Mine" });
    const theirs = commentView({ body: "Theirs" });
    setup({ trip: tripView({ role: "viewer", comments: [mine, theirs] }) });
    const threads = screen.getAllByText(/Mine|Theirs/).map((el) => el.closest(".thread") as HTMLElement);
    expect(within(threads[0]).getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(within(threads[1]).queryByRole("button", { name: "Resolve" })).toBeNull();
    // Viewers can delete their own comments only.
    expect(within(threads[0]).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(threads[1]).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("confirms before deleting", async () => {
    const fetch = mockFetch(() => null);
    const root = commentView();
    setup({ trip: tripView({ comments: [root] }) });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Its replies will be deleted too.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(fetch).toHaveBeenCalledWith(`/api/trips/${tripView().id}/comments/${root.id}`, expect.objectContaining({ method: "DELETE" }));
  });

  it("offers to ask the agent about open comments, for editors only", async () => {
    const { onAskAgent } = setup({ trip: tripView({ comments: [commentView()] }) });
    await userEvent.click(screen.getByRole("button", { name: /Ask PlanAway to address open comments/ }));
    expect(onAskAgent).toHaveBeenCalled();
  });

  it("disables asking the agent while it's busy", () => {
    setup({ trip: tripView({ comments: [commentView()] }), agentBusy: true });
    expect(screen.getByRole("button", { name: /Ask PlanAway/ })).toBeDisabled();
  });

  it("hides the agent button from viewers", () => {
    setup({ trip: tripView({ role: "viewer", comments: [commentView()] }) });
    expect(screen.queryByRole("button", { name: /Ask PlanAway/ })).toBeNull();
  });
});
