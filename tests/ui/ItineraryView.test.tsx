import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ItineraryView } from "@/components/ItineraryView";
import { fullLookup, sampleItinerary } from "../fixtures";

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

  it("boxes tips as a numbered list, and sources as links with their site", () => {
    const it = sampleItinerary();
    it.tips = ["Get an ICOCA card.", "Book temples early."];
    it.sources = [
      { title: "Kyoto travel guide", url: "https://www.example.com/guide" },
      { title: "Sketchy", url: "javascript:alert(1)" },
    ];
    setup(undefined, it);
    const tips = screen.getByRole("heading", { name: "Tips" }).closest("section")!;
    expect(within(tips).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Get an ICOCA card.", "Book temples early."]);

    const sources = screen.getByRole("heading", { name: "Sources" }).closest("section")!;
    expect(within(sources).getByText("2")).toHaveClass("info-box-count");
    const guide = within(sources).getByRole("link", { name: /Kyoto travel guide/ });
    expect(guide).toHaveAttribute("href", "https://www.example.com/guide");
    expect(guide).toHaveAttribute("target", "_blank");
    expect(guide).toHaveAttribute("rel", "noopener noreferrer");
    expect(guide).toHaveTextContent("example.com");
    // Unsafe URLs are shown, but never linked.
    expect(within(sources).queryByRole("link", { name: /Sketchy/ })).toBeNull();
    expect(within(sources).getByText("Sketchy")).toBeInTheDocument();
  });

  it("collapses each box as a whole, starting with tips open and sources closed", async () => {
    localStorage.clear();
    setup();
    const tipsToggle = screen.getByRole("button", { name: "Tips" });
    const sourcesToggle = screen.getByRole("button", { name: /^Sources/ });
    expect(tipsToggle).toHaveAttribute("aria-expanded", "true");
    expect(sourcesToggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed content is inert, so its links can't be tabbed to.
    expect(document.getElementById(sourcesToggle.getAttribute("aria-controls")!)).toHaveAttribute("inert");

    await userEvent.click(sourcesToggle);
    expect(sourcesToggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(sourcesToggle.getAttribute("aria-controls")!)).not.toHaveAttribute("inert");
    await userEvent.click(tipsToggle);
    expect(tipsToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("remembers which boxes were open", async () => {
    localStorage.clear();
    const { unmount } = render(
      <ItineraryView itinerary={sampleItinerary()} counts={new Map()} onComment={vi.fn()} lookup={fullLookup()} map={null} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Tips" }));
    await userEvent.click(screen.getByRole("button", { name: /^Sources/ }));
    unmount();
    setup();
    expect(screen.getByRole("button", { name: "Tips" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^Sources/ })).toHaveAttribute("aria-expanded", "true");
    localStorage.clear();
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

  it("shows photos once places are known", () => {
    const onComment = vi.fn();
    render(
      <ItineraryView itinerary={sampleItinerary()} counts={new Map()} onComment={onComment} lookup={fullLookup()} map={<div>MAP HERE</div>} />,
    );
    // Destination hero photos, activity and stay thumbnails.
    expect(screen.getByRole("button", { name: "Photos of Kyoto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photos of Nara" })).toBeInTheDocument();
    for (const name of ["Nishiki Market", "Pontocho dinner", "Todai-ji", "Gion Ryokan"]) {
      expect(screen.getByRole("button", { name: `Photos of ${name}` })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "Route" }).parentElement).toHaveTextContent("MAP HERE");
  });

  it("shows no photos or map section without them", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Photos of/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Route" })).toBeNull();
  });

  it("shows open comment counts on items", () => {
    setup(new Map([["day:d2", 2]]));
    const btn = screen.getByRole("button", { name: "2 comments on Day 2: Deer and Todai-ji" });
    expect(within(btn).getByText("2")).toBeInTheDocument();
    expect(btn).toHaveClass("has");
  });
});
