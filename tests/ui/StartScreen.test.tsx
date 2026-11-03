import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { pickSurpriseTheme, StartScreen, SURPRISE_THEMES } from "@/components/StartScreen";

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
    await userEvent.click(screen.getByRole("button", { name: "Plan my trip" }));
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

  it("Surprise me sits with I have an idea and starts from the saved defaults, not the other tab's form", async () => {
    const onStart = vi.fn(async () => {});
    render(<StartScreen onStart={onStart} onOpenSidebar={vi.fn()} defaults={{ currency: "EUR", origin: "Denver", travelMode: null, travelers: 2, pace: null, language: null }} />);
    await userEvent.click(screen.getByRole("tab", { name: "Plan it for me" }));
    expect(screen.queryByRole("button", { name: "Surprise me!" })).toBeNull();
    await userEvent.clear(screen.getByLabelText("Leaving from"));
    await userEvent.type(screen.getByLabelText("Leaving from"), "Boston");
    await userEvent.click(screen.getByRole("tab", { name: "I have an idea" }));
    // The idea box is required, but Surprise me doesn't need it.
    await userEvent.click(screen.getByRole("button", { name: "Surprise me!" }));
    const p = (onStart.mock.calls[0] as unknown as [string])[0];
    expect(p).toMatch(/^Surprise me!/);
    expect(p).toContain("Leaving from: Denver.");
    expect(p).not.toContain("Boston");
  });

  it("Surprise me picks the region itself, a different one each time, and avoids past trips", async () => {
    const onStart = vi.fn(async () => {});
    render(<StartScreen onStart={onStart} onOpenSidebar={vi.fn()} pastDestinations={["Muscat", "Kyoto"]} />);
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    await userEvent.click(screen.getByRole("button", { name: "Surprise me!" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Surprise me!" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Surprise me!" }));
    random.mockRestore();
    const [first, second] = onStart.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(first).toContain(`in ${SURPRISE_THEMES[0]}:`);
    expect(second).toContain(`in ${SURPRISE_THEMES[SURPRISE_THEMES.length - 1]}:`);
    expect(first).toContain("I've already planned trips to Muscat, Kyoto, so pick somewhere else.");
  });

  it("covers every theme", () => {
    const picked = new Set(SURPRISE_THEMES.map((_, i) => pickSurpriseTheme(() => (i + 0.5) / SURPRISE_THEMES.length)));
    expect(picked.size).toBe(SURPRISE_THEMES.length);
  });

  it("prevents double submits while starting", async () => {
    let finish!: () => void;
    const onStart = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<StartScreen onStart={onStart} onOpenSidebar={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Your trip idea"), "Paris");
    const button = screen.getByRole("button", { name: "Plan my trip" });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    finish();
    await vi.waitFor(() => expect(button).toBeEnabled());
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("waits while PlanAway is still planning another trip", async () => {
    const onStart = vi.fn(async () => {});
    const onOpenBusy = vi.fn();
    render(<StartScreen onStart={onStart} onOpenSidebar={vi.fn()} busyWith="Lisbon" onOpenBusy={onOpenBusy} />);
    expect(screen.getByRole("status")).toHaveTextContent("PlanAway is still working on “Lisbon”");
    expect(screen.getByRole("button", { name: "Plan my trip" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(onOpenBusy).toHaveBeenCalled();
  });

  it("pre-fills Plan it for me from the user's saved defaults", async () => {
    render(
      <StartScreen
        onStart={vi.fn(async () => {})}
        onOpenSidebar={vi.fn()}
        defaults={{ currency: "EUR", origin: "Lisbon", travelMode: "train", travelers: 3, pace: "relaxed", language: null }}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Plan it for me" }));
    expect(screen.getByLabelText("Leaving from")).toHaveValue("Lisbon");
    expect(screen.getByLabelText("Travelers")).toHaveValue(3);
    expect(screen.getByRole("combobox", { name: "Currency" })).toHaveValue("EUR");
    expect(screen.getByLabelText("Pace")).toHaveValue("relaxed");
  });
});
