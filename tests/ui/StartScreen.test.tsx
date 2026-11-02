import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StartScreen } from "@/components/StartScreen";

function setup() {
  const onStart = vi.fn(async () => {});
  render(<StartScreen onStart={onStart} onOpenSidebar={vi.fn()} />);
  return { onStart };
}

const prompt = (onStart: ReturnType<typeof setup>["onStart"]) => (onStart.mock.calls[0] as unknown as [string])[0];

describe("StartScreen", () => {
  it("sends a free-form idea", async () => {
    const { onStart } = setup();
    await userEvent.type(screen.getByLabelText("Your trip idea"), "  10 days in Japan  ");
    await userEvent.click(screen.getByRole("button", { name: "Plan this trip" }));
    expect(onStart).toHaveBeenCalledWith("10 days in Japan");
  });

  it("builds a structured prompt from the form", async () => {
    const { onStart } = setup();
    await userEvent.click(screen.getByRole("tab", { name: "Plan it for me" }));
    expect(screen.getByRole("tab", { name: "Plan it for me" })).toHaveAttribute("aria-selected", "true");
    await userEvent.type(screen.getByLabelText("Leaving from"), "Boston");
    await userEvent.clear(screen.getByLabelText("Travelers"));
    await userEvent.type(screen.getByLabelText("Travelers"), "4");
    await userEvent.type(screen.getByLabelText("Total budget"), "5000");
    await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await userEvent.type(screen.getByLabelText("Trip length (days)"), "6");
    await userEvent.selectOptions(screen.getByLabelText("Pace"), "relaxed");
    await userEvent.click(screen.getByLabelText("Beaches"));
    await userEvent.click(screen.getByLabelText("Food & drink"));
    await userEvent.click(screen.getByLabelText("Beaches")); // toggled back off
    await userEvent.type(screen.getByLabelText(/Anything else/), "Vegetarian");
    await userEvent.click(screen.getByRole("button", { name: "Build my trip" }));

    expect(prompt(onStart)).toBe(
      [
        "Build a vacation plan for me.",
        "I don't have a destination in mind; pick one that fits what I like and explain why you chose it.",
        "Leaving from: Boston.",
        "Travelers: 4.",
        "Total budget: 5000 EUR, including flights and lodging.",
        "Trip length: 6 days.",
        "Pace: relaxed.",
        "Interests: food & drink.",
        "Other notes: Vegetarian",
      ].join("\n"),
    );
  });

  it("includes destination ideas when given", async () => {
    const { onStart } = setup();
    await userEvent.click(screen.getByRole("tab", { name: "Plan it for me" }));
    await userEvent.type(screen.getByLabelText(/Destination ideas/), "Portugal");
    await userEvent.click(screen.getByRole("button", { name: "Build my trip" }));
    expect(prompt(onStart)).toContain("Destination ideas: Portugal.");
  });

  it("Surprise me uses only the shared constraints", async () => {
    const { onStart } = setup();
    await userEvent.click(screen.getByRole("tab", { name: "Plan it for me" }));
    await userEvent.type(screen.getByLabelText("Leaving from"), "Denver");
    await userEvent.click(screen.getByLabelText("Nightlife"));
    await userEvent.click(screen.getByRole("button", { name: "Surprise me!" }));
    const p = prompt(onStart);
    expect(p).toMatch(/^Surprise me!/);
    expect(p).toContain("Leaving from: Denver.");
    expect(p).not.toContain("Interests");
  });

  it("prevents double submits while starting", async () => {
    let finish!: () => void;
    const onStart = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<StartScreen onStart={onStart} onOpenSidebar={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Your trip idea"), "Paris");
    const button = screen.getByRole("button", { name: "Plan this trip" });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    finish();
    await vi.waitFor(() => expect(button).toBeEnabled());
    expect(onStart).toHaveBeenCalledOnce();
  });
});
