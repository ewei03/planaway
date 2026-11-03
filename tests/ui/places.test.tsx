import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverPhotos, PlaceThumb, PhotoViewer, credit, useLegs, usePlaces } from "@/components/places";
import { buildRoute, dayPath, legKey, normalizeQuery, placeQueries, type Route } from "@/lib/route";
import { fakePlace, fullLookup, sampleItinerary } from "../fixtures";
import { mockFetch } from "./fixtures";

const kyoto = fakePlace("Kyoto");

describe("credit", () => {
  it("names the author and license", () => {
    expect(credit(kyoto.photos[0])).toBe("Photo: Aiko, CC BY-SA 4.0");
    expect(credit({ ...kyoto.photos[0], author: null })).toBe("Photo: CC BY-SA 4.0");
    expect(credit(kyoto.photos[1])).toBe("Photo from Wikimedia Commons");
  });
});

describe("PlaceThumb", () => {
  it("renders nothing without a place or photo", () => {
    const { container } = render(
      <>
        <PlaceThumb place={undefined} label="x" />
        <PlaceThumb place={null} label="x" />
        <PlaceThumb place={{ ...kyoto, photos: [] }} label="x" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a lazy thumbnail with credit, and opens the viewer", async () => {
    render(<PlaceThumb place={kyoto} label="Kyoto" />);
    const button = screen.getByRole("button", { name: "Photos of Kyoto" });
    expect(button).toHaveAttribute("title", "Photo: Aiko, CC BY-SA 4.0");
    const img = button.querySelector("img")!;
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("src", kyoto.photos[0].thumb);
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Photos of Kyoto" })).toBeInTheDocument();
  });

  it("disappears if the image fails to load", () => {
    render(<PlaceThumb place={kyoto} label="Kyoto" />);
    act(() => {
      screen.getByRole("button").querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CoverPhotos", () => {
  const photo = (label: string) => ({ place: fakePlace(label), photo: fakePlace(label).photos[0], label });

  it("shows the first photo as the cover and two more as insets, all credited", () => {
    render(<CoverPhotos photos={["Kyoto", "Nara", "Osaka", "Kobe"].map(photo)} />);
    expect(screen.getAllByRole("button", { name: /^Photos of/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Photos of Kyoto",
      "Photos of Nara",
      "Photos of Osaka",
    ]);
    expect(screen.getByRole("img", { name: "Kyoto" })).toBeInTheDocument();
    expect(screen.getByText("Nara")).toBeInTheDocument();
    expect(screen.queryByText("Kobe")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Photo: Aiko, CC BY-SA 4.0" })).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "Photo: Aiko, CC BY-SA 4.0" })[0]).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File:kyoto-a.jpg",
    );
  });

  it("renders nothing without photos", () => {
    const { container } = render(<CoverPhotos photos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PhotoViewer", () => {
  it("pages through photos and links to OpenStreetMap", async () => {
    render(<PhotoViewer place={kyoto} label="Kyoto" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "Kyoto, photo 1 of 2");
    expect(within(dialog).getByText("Photo: Aiko, CC BY-SA 4.0")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next photo" }));
    expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "Kyoto, photo 2 of 2");
    expect(within(dialog).getByText("Photo from Wikimedia Commons")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next photo" }));
    expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "Kyoto, photo 1 of 2");
    expect(within(dialog).getByRole("link", { name: /Open in OpenStreetMap/ })).toHaveAttribute("href", "https://www.openstreetmap.org/node/0");
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<PhotoViewer place={kyoto} label="Kyoto" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("usePlaces", () => {
  let latest: ReturnType<typeof usePlaces>;
  function Harness({ it }: { it: ReturnType<typeof sampleItinerary> | null }) {
    latest = usePlaces(it);
    return null;
  }

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  /** Answers like the server: everything asked, or only the first `perCall` queries. */
  function serve(perCall = Infinity) {
    return mockFetch((_url, init) => {
      const { queries } = JSON.parse(init!.body as string) as { queries: string[] };
      const answered = queries.slice(0, perCall);
      return { places: Object.fromEntries(answered.map((q) => [normalizeQuery(q), q.startsWith("Pontocho") ? null : fakePlace(q)])) };
    });
  }

  it("looks up the itinerary's places after a short debounce", async () => {
    const fetch = serve();
    const it = sampleItinerary();
    render(<Harness it={it} />);
    expect(latest.loading).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).queries).toEqual(placeQueries(it));
    expect(latest.loading).toBe(false);
    expect(latest.lookup("area:kyoto")?.name).toBe("Kyoto");
    expect(latest.lookup("Pontocho dinner, Kyoto")).toBeNull();
    expect(latest.lookup("Osaka")).toBeUndefined();
  });

  it("keeps asking while the server answers a few at a time", async () => {
    const fetch = serve(3);
    const it = sampleItinerary();
    render(<Harness it={it} />);
    for (let i = 0; i < 5; i++) await act(() => vi.advanceTimersByTimeAsync(500));
    // 8 places, 3 per answer.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).queries).toEqual(placeQueries(it).slice(3));
    expect(latest.loading).toBe(false);
  });

  it("only asks for new places when the itinerary changes", async () => {
    const fetch = serve();
    const { rerender } = render(<Harness it={sampleItinerary()} />);
    await act(() => vi.advanceTimersByTimeAsync(500));
    const next = sampleItinerary();
    next.days[0].activities[0].name = "Fushimi Inari";
    rerender(<Harness it={next} />);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).queries).toEqual(["Fushimi Inari, Kyoto"]);
  });

  it("does nothing without an itinerary", async () => {
    const fetch = serve();
    render(<Harness it={null} />);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetch).not.toHaveBeenCalled();
    expect(latest.loading).toBe(false);
  });

  it("gives up quietly when the lookup fails, without retrying", async () => {
    const fetch = mockFetch(() => Response.json({ error: "nope" }, { status: 500 }));
    render(<Harness it={sampleItinerary()} />);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetch).toHaveBeenCalledOnce();
    expect(latest.loading).toBe(false);
  });
});

describe("useLegs", () => {
  let latest: ReturnType<typeof useLegs>;
  function Harness({ route }: { route: Route }) {
    latest = useLegs(route);
    return null;
  }

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const route = buildRoute(sampleItinerary(), fullLookup());
  const walk = { mode: "walk", meters: 500, seconds: 400, path: [] };

  /** Answers like the server: every leg of the first `perCall` sequences. */
  function serve(perCall = Infinity) {
    return mockFetch((_url, init) => {
      const { sequences } = JSON.parse(init!.body as string) as { sequences: [number, number][][] };
      const legs: Record<string, unknown> = {};
      for (const seq of sequences.slice(0, perCall)) {
        for (let i = 1; i < seq.length; i++) legs[legKey({ lat: seq[i - 1][0], lng: seq[i - 1][1] }, { lat: seq[i][0], lng: seq[i][1] })] = walk;
      }
      return { legs };
    });
  }

  it("routes each day's stops, from the stay and back", async () => {
    const fetch = serve();
    render(<Harness route={route} />);
    expect(latest.loading).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("/api/routes");
    const { sequences } = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(sequences).toEqual(route.days.map((d) => dayPath(d).map((p) => [p.lat, p.lng])));
    expect(latest.loading).toBe(false);
    const [stay, first] = dayPath(route.days[0]);
    expect(latest.legs(stay, first)).toEqual(walk);
    expect(latest.legs(first, stay)).toBeUndefined();
  });

  it("keeps asking while the server routes a day at a time", async () => {
    const fetch = serve(1);
    render(<Harness route={route} />);
    for (let i = 0; i < 4; i++) await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).sequences).toHaveLength(1);
    expect(latest.loading).toBe(false);
  });

  it("gives up, leaving straight lines, when routing fails", async () => {
    const fetch = mockFetch(() => new Response("down", { status: 500 }));
    render(<Harness route={route} />);
    for (let i = 0; i < 3; i++) await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetch).toHaveBeenCalledOnce();
    expect(latest.loading).toBe(false);
    const [stay, first] = dayPath(route.days[0]);
    expect(latest.legs(stay, first)).toBeUndefined();
  });
});
