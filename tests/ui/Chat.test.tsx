import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Chat } from "@/components/Chat";
import { me, sam, tripView } from "./fixtures";

function setup(overrides: Partial<ComponentProps<typeof Chat>> = {}) {
  const props: ComponentProps<typeof Chat> = {
    trip: tripView(),
    user: me,
    live: [],
    working: false,
    status: "",
    onSend: vi.fn(),
    onRename: vi.fn(),
    onOpenSidebar: vi.fn(),
    onShowItinerary: vi.fn(),
    ...overrides,
  };
  render(<Chat {...props} />);
  return props;
}

const composer = () => screen.getByPlaceholderText(/Refine the plan/);

describe("Chat", () => {
  it("prompts editors to describe the trip when empty", () => {
    setup({ trip: tripView({ chat: [] }) });
    expect(screen.getByText(/Describe the trip to get started/)).toBeInTheDocument();
  });

  it("shows who sent each message", () => {
    setup({
      trip: tripView({
        chat: [
          { id: "1", role: "user", text: "Plan Kyoto", at: "", author: sam },
          { id: "2", role: "assistant", text: "**Done.** Here it is.", at: "", author: null },
          { id: "3", role: "user", text: "Thanks!", at: "", author: { id: me.id, name: me.name } },
        ],
      }),
    });
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("Done.").tagName).toBe("STRONG");
    // Your own messages have no author label.
    expect(screen.queryByText("Maya")).toBeNull();
    expect(screen.getByText("Thanks!").closest(".msg-wrap")).toHaveClass("mine");
  });

  it("sends on Enter, trims, and clears the draft", async () => {
    const { onSend } = setup();
    await userEvent.type(composer(), "  cheaper hotels  {Enter}");
    expect(onSend).toHaveBeenCalledWith("cheaper hotels");
    expect(composer()).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const { onSend } = setup();
    await userEvent.type(composer(), "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(composer()).toHaveValue("line one\nline two");
  });

  it("ignores blank messages", async () => {
    const { onSend } = setup();
    await userEvent.type(composer(), "   {Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables sending and shows status while working", () => {
    setup({ working: true, status: "Searching: kyoto ryokan" });
    expect(composer()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText("Searching: kyoto ryokan")).toBeInTheDocument();
  });

  it("shows streaming replies and failed turns", () => {
    setup({
      live: [
        { text: "first", reply: "", error: "Rate limited by the Anthropic API." },
        { text: "second", reply: "Working on *it*", error: null },
      ],
    });
    expect(screen.getByText("Rate limited by the Anthropic API.")).toHaveClass("error");
    expect(screen.getByText("it").tagName).toBe("EM");
  });

  it("lets editors rename the trip; Escape cancels", async () => {
    const { onRename } = setup();
    await userEvent.click(screen.getByRole("heading", { name: "Kyoto Food Weekend" }));
    const input = screen.getByRole("textbox", { name: "Trip name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Kyoto 2027{Enter}");
    expect(onRename).toHaveBeenCalledWith("Kyoto 2027");

    await userEvent.click(screen.getByRole("heading"));
    await userEvent.type(screen.getByRole("textbox", { name: "Trip name" }), " nope{Escape}");
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it("doesn't rename to an empty or unchanged title", async () => {
    const { onRename } = setup();
    await userEvent.click(screen.getByRole("heading"));
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("heading"));
    await userEvent.clear(screen.getByRole("textbox", { name: "Trip name" }));
    await userEvent.keyboard("{Enter}");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("is read-only for viewers", async () => {
    setup({ trip: tripView({ role: "viewer" }) });
    expect(screen.queryByPlaceholderText(/Refine the plan/)).toBeNull();
    expect(screen.getByText(/You have view access/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("heading"));
    expect(screen.queryByRole("textbox", { name: "Trip name" })).toBeNull();
  });
});
