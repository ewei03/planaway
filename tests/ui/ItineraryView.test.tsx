import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ItineraryView } from "@/components/ItineraryView";
import { sampleItinerary } from "../fixtures";

function setup(counts = new Map<string, number>(), itinerary = sampleItinerary()) {
  const onComment = vi.fn();
  render(<ItineraryView itinerary={itinerary} counts={counts} onComment={onComment} />);
  return { onComment };
}

describe("ItineraryView", () => {
  it("shows the title, summary, and key facts", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Kyoto Food Weekend" })).toBeInTheDocument();
    expect(screen.getByText(/temples, markets/)).toBeInTheDocument();
    expect(screen.getByText("From:").parentElement).toHaveTextContent("San Francisco");
    expect(screen.getByText("Dates:").parentElement).toHaveTextContent("2027-04-02 → 2027-04-04");
    expect(screen.getByText("Days:").parentElement).toHaveTextContent("2");
  });

  it("renders every section", () => {
    setup();
    for (const name of ["Flights", "Where to stay", "Day by day", "Budget", "Tips", "Sources"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Nishiki Market")).toBeInTheDocument();
    expect(screen.getByText("Estimated total")).toBeInTheDocument();
  });

  it("hides empty optional sections", () => {
    const it = sampleItinerary();
    it.flights = [];
    it.lodging = [];
    it.tips = [];
    it.sources = [];
    setup(undefined, it);
    for (const name of ["Flights", "Where to stay", "Tips", "Sources"]) {
      expect(screen.queryByRole("heading", { name })).toBeNull();
    }
  });

  it("links safe URLs in a new tab and never links javascript: URLs", () => {
    setup();
    const nishiki = screen.getByRole("link", { name: "Nishiki Market" });
    expect(nishiki).toHaveAttribute("href", "https://example.com/nishiki");
    expect(nishiki).toHaveAttribute("rel", "noopener noreferrer");
    // a3's url is javascript:alert(1); it should render as plain text.
    expect(screen.queryByRole("link", { name: "Todai-ji" })).toBeNull();
    expect(screen.getByText("Todai-ji")).toBeInTheDocument();
  });

  it("opens a comment anchor for the clicked item", async () => {
    const { onComment } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Comment on Day 1 · Nishiki Market" }));
    expect(onComment).toHaveBeenLastCalledWith({ type: "activity", id: "a1", label: "Day 1 · Nishiki Market" });
    await userEvent.click(screen.getByRole("button", { name: "Comment on Whole trip" }));
    expect(onComment).toHaveBeenLastCalledWith({ type: "trip", id: null, label: "Whole trip" });
    await userEvent.click(screen.getByRole("button", { name: "Comment on Flight SFO → KIX" }));
    expect(onComment).toHaveBeenLastCalledWith({ type: "flight", id: "f1", label: "Flight SFO → KIX" });
  });

  it("shows open comment counts on items", () => {
    setup(new Map([["day:d2", 2]]));
    const btn = screen.getByRole("button", { name: "2 comments on Day 2: Deer and Todai-ji" });
    expect(within(btn).getByText("2")).toBeInTheDocument();
    expect(btn).toHaveClass("has");
  });
});
