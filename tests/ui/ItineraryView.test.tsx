import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ItineraryView } from "@/components/ItineraryView";
import { createMapFocus, MapFocusProvider } from "@/components/mapFocus";
import { DAY_COLORS, type LegLookup } from "@/lib/route";
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

describe("stops and the map", () => {
  // 900 m on foot between any two different places.
  const legs: LegLookup = (a, b) => (a.lat === b.lat && a.lng === b.lng ? null : { mode: "walk", meters: 900, seconds: 660, path: [] });

  function setupMap() {
    const focus = createMapFocus();
    render(
      <MapFocusProvider value={focus}>
        <ItineraryView itinerary={sampleItinerary()} counts={new Map()} onComment={vi.fn()} lookup={fullLookup()} legs={legs} map={<div />} />
      </MapFocusProvider>,
    );
    return focus;
  }

  it("numbers each mapped stop like its pin, in the day's color", () => {
    setupMap();
    const badge = screen.getByRole("button", { name: "Stop 2: show Pontocho dinner on the map" });
    expect(badge).toHaveTextContent("2");
    expect(badge.closest("li")).toHaveStyle({ "--day": DAY_COLORS[0] });
    expect(screen.getByRole("button", { name: "Stop 1: show Todai-ji on the map" }).closest("li")).toHaveStyle({ "--day": DAY_COLORS[1] });
  });

  it("has no stop badges before places are known", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Stop \d/ })).toBeNull();
  });

  it("picks stops for the map, docking it, and marks them in the timeline", async () => {
    const focus = setupMap();
    const nishiki = screen.getByRole("button", { name: "Stop 1: show Nishiki Market on the map" });
    await userEvent.click(nishiki);
    expect(focus.get()).toEqual({ day: 1, range: { day: 1, from: 1, to: 1 }, spot: null, docked: true });
    expect(nishiki).toHaveAttribute("aria-pressed", "true");
    expect(nishiki.closest("li")).toHaveClass("picked");

    await userEvent.click(screen.getByRole("button", { name: "Stop 2: show Pontocho dinner on the map" }));
    expect(focus.get().range).toEqual({ day: 1, from: 1, to: 2 });
    expect(screen.getByRole("button", { name: "Stop 2: show Pontocho dinner on the map" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows how to get to the next stop, and picks that leg on click", async () => {
    const focus = setupMap();
    const leg = screen.getByRole("button", { name: "🚶 11 min · 900 m to Pontocho dinner: show the way on the map" });
    expect(leg).toHaveTextContent("🚶 11 min · 900 m");
    // The last stop of a day has nowhere to go.
    expect(screen.queryByRole("button", { name: /to Todai-ji/ })).toBeNull();
    await userEvent.click(leg);
    expect(focus.get().range).toEqual({ day: 1, from: 1, to: 2 });
    expect(leg).toHaveClass("picked");
  });

  it("follows picks made on the map", () => {
    const focus = setupMap();
    act(() => focus.pick({ day: 2, from: 1, to: 1 }));
    expect(screen.getByRole("button", { name: "Stop 1: show Todai-ji on the map" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Stop 1: show Nishiki Market on the map" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the map in view by default; its header hides it and shows it again", async () => {
    const focus = setupMap();
    const head = screen.getByRole("button", { name: "Route" });
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(head.closest("section")).toHaveClass("stuck");
    await userEvent.click(head);
    expect(focus.get().docked).toBe(false);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(head.closest("section")).not.toHaveClass("stuck");
    expect(localStorage.getItem("planaway:map-hidden")).toBe("1");
    // Picking a stop brings the map back.
    await userEvent.click(screen.getByRole("button", { name: "Stop 1: show Todai-ji on the map" }));
    expect(head).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(head);
    await userEvent.click(head);
    expect(focus.get().docked).toBe(true);
    expect(localStorage.getItem("planaway:map-hidden")).toBeNull();
  });

  it("shows a stop on the map from anywhere on its card, but its own links still work", async () => {
    const focus = setupMap();
    const card = (name: string) => screen.getByRole("button", { name: `Stop 1: show ${name} on the map` }).closest(".act-card")!;
    await userEvent.click(card("Todai-ji").querySelector(".act-desc")!);
    expect(focus.get().range).toEqual({ day: 2, from: 1, to: 1 });
    act(() => focus.pick(null));
    const link = within(card("Nishiki Market") as HTMLElement).getByRole("link", { name: "Nishiki Market" });
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(focus.get().range).toBeNull();
  });

  it("shows stays and flights on the map from their rows, with no buttons of their own", async () => {
    const focus = setupMap();
    const stay = screen.getByTitle("Show Gion Ryokan on the map");
    expect(stay).toHaveClass("row");
    expect(within(stay).queryByRole("button", { name: /on the map/ })).toBeNull();
    await userEvent.click(stay);
    expect(focus.get()).toMatchObject({ spot: "l1", docked: true });
    expect(stay).toHaveAttribute("aria-current", "true");
    expect(stay).toHaveClass("picked");
    await userEvent.click(stay);
    expect(focus.get().spot).toBeNull();
    await userEvent.click(screen.getByTitle("Show the flight SFO → KIX on the map"));
    expect(focus.get().spot).toBe("f1");
  });

  it("shows items on the map from the keyboard", async () => {
    const focus = setupMap();
    const stay = screen.getByTitle("Show Gion Ryokan on the map");
    stay.focus();
    await userEvent.keyboard("{Enter}");
    expect(focus.get().spot).toBe("l1");
    screen.getByTitle("Show Todai-ji on the map").focus();
    await userEvent.keyboard(" ");
    expect(focus.get().range).toEqual({ day: 2, from: 1, to: 1 });
  });

  function renderMissing(onFind?: (day: number, a: { name: string }) => Promise<boolean>) {
    const lookup = fullLookup();
    render(
      <ItineraryView
        itinerary={sampleItinerary()}
        counts={new Map()}
        onComment={vi.fn()}
        lookup={(q) => (q.startsWith("Todai-ji") ? null : lookup(q))}
        legs={legs}
        map={<div />}
        onFind={onFind}
      />,
    );
  }

  it("looks for a place the map couldn't find when its card is clicked, without any text", async () => {
    let answer!: (found: boolean) => void;
    const onFind = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
    renderMissing(onFind);
    expect(screen.queryByRole("button", { name: /show Todai-ji on the map/ })).toBeNull();
    expect(screen.queryByText(/Find on the map/)).toBeNull();
    const card = screen.getByTitle("Find Todai-ji on the map");
    await userEvent.click(within(card).getByText("The giant Buddha hall."));
    expect(onFind).toHaveBeenCalledWith(2, expect.objectContaining({ name: "Todai-ji" }));
    expect(card).toHaveAttribute("aria-busy", "true");
    // A second click while it's looking doesn't look twice.
    await userEvent.click(card);
    expect(onFind).toHaveBeenCalledOnce();
    await act(async () => answer(true));
    expect(card).not.toHaveAttribute("aria-busy");
  });

  it("opens OpenStreetMap's search when the place isn't anywhere near", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderMissing(async () => false);
    await userEvent.click(screen.getByTitle("Find Todai-ji on the map"));
    const card = await screen.findByTitle("Todai-ji wasn't found nearby. Search OpenStreetMap");
    await userEvent.click(card);
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/www\.openstreetmap\.org\/search\?query=Todai-ji/), "_blank", "noopener,noreferrer");
  });

  it("isn't clickable when there's no trip map to find it on", () => {
    renderMissing();
    expect(screen.queryByTitle(/Todai-ji/)).toBeNull();
  });

  it("numbers a stop found by its closest match like any other, with no note", () => {
    const lookup = fullLookup();
    render(
      <ItineraryView
        itinerary={sampleItinerary()}
        counts={new Map()}
        onComment={vi.fn()}
        lookup={(q) => (q.startsWith("Todai-ji") ? { ...lookup(q)!, name: "Tōdai-ji Temple", guess: true } : lookup(q))}
        legs={legs}
        map={<div />}
      />,
    );
    expect(screen.getByRole("button", { name: "Stop 1: show Todai-ji on the map" })).toBeInTheDocument();
    expect(screen.queryByText(/closest match/)).toBeNull();
  });

  it("has no map buttons for stays and flights without a map", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Show .* on the map$/ })).toBeNull();
  });
});
