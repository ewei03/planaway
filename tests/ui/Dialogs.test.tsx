import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DialogProvider, useDialogs } from "@/components/Dialogs";

/** Renders a button that opens a dialog and records how it resolved. */
function Harness({ kind }: { kind: "ask" | "confirm" }) {
  const dialogs = useDialogs();
  return (
    <button
      onClick={async () => {
        const result =
          kind === "ask"
            ? await dialogs.ask({ title: "Name it", label: "Name", defaultValue: "Version 1" })
            : await dialogs.confirm({ title: "Delete trip?", danger: true });
        document.body.dataset.result = JSON.stringify(result);
      }}
    >
      open
    </button>
  );
}

function setup(kind: "ask" | "confirm") {
  delete document.body.dataset.result;
  render(
    <DialogProvider>
      <Harness kind={kind} />
    </DialogProvider>,
  );
  return userEvent.click(screen.getByRole("button", { name: "open" }));
}

const result = () => document.body.dataset.result && JSON.parse(document.body.dataset.result);

describe("dialogs.ask", () => {
  it("resolves with the trimmed value", async () => {
    await setup("ask");
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("Version 1");
    await userEvent.clear(input);
    await userEvent.type(input, "  Final  {Enter}");
    expect(result()).toBe("Final");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves null on cancel", async () => {
    await setup("ask");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(result()).toBeNull();
  });

  it("won't submit an empty value", async () => {
    await setup("ask");
    await userEvent.clear(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    expect(result()).toBeUndefined();
  });
});

describe("dialogs.confirm", () => {
  it("resolves true on confirm, with a destructive button", async () => {
    await setup("confirm");
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveClass("danger-fill");
    await userEvent.click(button);
    expect(result()).toBe(true);
  });

  it("resolves false when the backdrop is clicked", async () => {
    await setup("confirm");
    await userEvent.click(screen.getByRole("dialog"));
    expect(result()).toBe(false);
  });
});

it("useDialogs throws outside the provider", () => {
  const Broken = () => {
    useDialogs();
    return null;
  };
  expect(() => render(<Broken />)).toThrow("useDialogs must be used inside <DialogProvider>");
});
