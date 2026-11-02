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
    expect(screen.getByText("Kyoto · Nara")).toBeInTheDocument();
    const stat = (label: string) => screen.getByText(label).closest(".stat");
    expect(stat("From")).toHaveTextContent("San Francisco");
    expect(stat("Dates")).toHaveTextContent(/Apr 2 – 4\s*2 days/);
    expect(stat("Travelers")).toHaveTextContent("2 people");
    expect(stat("Est. total")).toHaveTextContent("$4,200");
  });

  it("sets the estimated total apart, with the cost per person", () => {
    setup();
    const total = screen.getByText("Estimated total").closest(".budget-total");
    expect(total).toHaveTextContent(/\S*4,200/);
    expect(total).toHaveTextContent(/About \S*2,100 per person, for 2 travelers/);
  });

  it("draws the budget as a bar, in the same colors as the budget rows", () => {
    setup();
    expect(screen.getByRole("img", { name: /^Budget: Flights \S*2,400, Lodging \S*900$/ })).toBeInTheDocument();
  });

  it("marks each activity with its category", () => {
    setup();
    expect(screen.getAllByRole("img", { name: "food" }).length).toBeGreaterThan(0);
  });

  it("renders every section", () => {
    setup();
    for (const name of ["Flights", "Where to stay", "Day by day", "Budget", "Tips", "Sources"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Nishiki Market")).toBeInTheDocument();
    expect(screen.getByText("Estimated total")).toBeInTheDocument();
  });

  it("collapses a box from its heading", async () => {
    setup();
    const toggle = within(screen.getByRole("heading", { name: "Budget" })).getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed content is inert, so its buttons leave the tab order.
    expect(screen.getByRole("button", { name: "Comment on Budget: Flights" }).closest("[inert]")).not.toBeNull();
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

  it("starts a new itinerary with every box expanded, sources included", () => {
    localStorage.clear();
    render(<ItineraryView itinerary={sampleItinerary()} counts={new Map()} onComment={vi.fn()} tripId="new-trip" map={<div />} />);
    for (const name of ["Route", "Flights", "Where to stay", "Day by day", "Budget", "Tips", "Sources"]) {
      expect(within(screen.getByRole("heading", { name })).getByRole("button")).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("remembers collapsed boxes per trip, so other trips still open expanded", async () => {
    localStorage.clear();
    const view = (tripId: string) =>
      render(<ItineraryView itinerary={sampleItinerary()} counts={new Map()} onComment={vi.fn()} tripId={tripId} />);
    const tips = () => screen.getByRole("button", { name: "Tips" });
    const first = view("trip-a");
    await userEvent.click(tips());
    first.unmount();

    const again = view("trip-a");
    expect(tips()).toHaveAttribute("aria-expanded", "false");
    again.unmount();

    view("trip-b");
    expect(tips()).toHaveAttribute("aria-expanded", "true");
    localStorage.clear();
  });

  it("opens a comment anchor for the clicked item", async () => {
    const { onComment } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Comment on Day 1 · Nishiki Market" }));
    expect(onComment).toHaveBeenLastCalledWith({ type: "activity", id: "a1", label: "Day 1 · Nishiki Market" });
    expect(screen.queryByRole("button", { name: "Comment on Whole trip" })).toBeNull();
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
    setup(new Map([["activity:a3", 2]]));
    const btn = screen.getByRole("button", { name: "2 comments on Day 2 · Todai-ji" });
    expect(within(btn).getByText("2")).toBeInTheDocument();
    expect(btn).toHaveClass("has");
  });

  it("heads each day as one line, e.g. Day 1: Arrival", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Day 1: Arrival and Nishiki Market" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Day 2: Deer and Todai-ji" })).toBeInTheDocument();
  });

  it("says what weather to expect and how to prepare, without exact temperatures", () => {
    setup();
    const note = screen.getByText("What to expect:").closest(".weather-note");
    expect(note).toHaveTextContent("Mild days and cool evenings; spring showers are common.");
    expect(note).toHaveTextContent("Pack layers, a light rain jacket, and comfortable waterproof shoes.");
    expect(note).not.toHaveTextContent(/\d+°/);
  });

  it("leaves weather out of itineraries saved before it existed", () => {
    const it = sampleItinerary();
    delete (it as Partial<typeof it>).weather;
    setup(undefined, it);
    expect(screen.queryByText("What to expect:")).toBeNull();
  });

  it("takes comments on activities, not on whole days", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Comment on Day \d+:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Comment on Day 2 · Todai-ji" })).toBeInTheDocument();
  });

  it("shows the nightly price with a quieter unit", () => {
    setup();
    expect(screen.getByText("/ night", { exact: false })).toHaveClass("price-unit");
  });
});
