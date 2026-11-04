"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useId, useRef, useState } from "react";
import {
  DAY_COLORS,
  FLIGHT_COLOR,
  STAY_COLOR,
  dayColor,
  dayStops,
  formatDistance,
  formatDuration,
  greatCircle,
  legLabel,
  unwrapLng,
  type DayRoute,
  type LegLookup,
  type Route,
  type Stop,
} from "@/lib/route";
import { safeUrl } from "./client";
import { BED_PATHS, PLANE_PATHS } from "./icons";
import { rememberMapShown, useFocusValue, useMapFocus, type MapFocus, type StopRange } from "./mapFocus";
import { credit, useMapsConfig } from "./places";

// The route map: numbered stops and each day's way between them, stays, and
// flights. It's drawn from `buildRoute`, so it follows the itinerary on screen,
// including live revisions while the agent works and saved versions. Lines
// follow the streets once `useLegs` has routed them (straight dashes until
// then). Drawn with MapLibre on OpenFreeMap tiles (OpenStreetMap data): free,
// no API key. Picking stops here or in the timeline focuses both (mapFocus).

export { DAY_COLORS, dayColor };

type MapLibre = typeof import("maplibre-gl");

interface Props {
  route: Route;
  /** Street routes between stops; see useLegs. */
  legs: LegLookup;
  /** Places are still being looked up. */
  loading: boolean;
  /** Routes between stops are still being worked out. */
  routing?: boolean;
}

export function TripMap({ route, legs, loading, routing = false }: Props) {
  const { styleUrl } = useMapsConfig();
  const focus = useMapFocus();
  const day = useFocusValue((s) => s.day);
  const range = useFocusValue((s) => s.range);
  const spot = useFocusValue((s) => s.spot);
  const docked = useFocusValue((s) => s.docked);
  const mappedDays = route.days.filter((d) => d.stops.length > 0);

  // Forget a day or stops that no longer exist after a revision.
  useEffect(() => {
    const shown = day === null ? null : route.days.find((d) => d.day === day && d.stops.length > 0);
    if (day !== null && !shown) focus.showDay(null);
    else if (range && (!shown || range.from < 1 || range.to > shown.stops.length || range.from > range.to)) focus.pick(null);
  }, [day, range, route, focus]);

  // A picked stay or flight: show every day unless the day on screen has it (flights are drawn only for all days).
  useEffect(() => {
    if (!spot) return;
    const stay = route.lodging.some((s) => s.id === spot);
    if (!stay && !route.flights.some((f) => f.id === spot)) focus.pickSpot(null);
    else if (day !== null && (!stay || route.days.find((d) => d.day === day)?.lodging?.id !== spot)) focus.pickSpot(spot, { day: null });
  }, [spot, day, route, focus]);

  const summary = summarize(route, legs, day, range, routing, spot);

  return (
    <div className="trip-map">
      {route.points.length > 0 && (
        <div className="map-toolbar">
          <MapSearch route={route} focus={focus} />
          {mappedDays.length > 1 && (
            <div className="map-days" role="group" aria-label="Show day on map">
              <button className={`chip-btn ${day === null ? "active" : ""}`} aria-pressed={day === null} onClick={() => focus.showDay(null)}>
                All days
              </button>
              {mappedDays.map((d) => (
                <button
                  key={d.day}
                  className={`chip-btn ${day === d.day ? "active" : ""}`}
                  aria-pressed={day === d.day}
                  title={d.title}
                  onClick={() => focus.showDay(d.day)}
                >
                  <span className="day-dot" style={{ background: dayColor(d.day) }} aria-hidden="true" />
                  Day {d.day}
                </button>
              ))}
            </div>
          )}
          <button
            className="chip-btn map-dock"
            onClick={() => {
              rememberMapShown(false);
              focus.setDocked(false);
            }}
          >
            Hide map
          </button>
        </div>
      )}
      <MapView
        styleUrl={styleUrl}
        route={route}
        legs={legs}
        day={day}
        range={range}
        spot={spot}
        docked={docked}
        focus={focus}
        summary={summary}
        hint={route.points.length > 0}
      />
      {loading && <div className="map-status muted small">Finding places…</div>}
      {!loading && route.points.length === 0 && <div className="map-status muted small">No places to show yet.</div>}
    </div>
  );
}

/** Something on the map to search for: an activity, a stay, or a flight. */
interface SearchItem {
  key: string;
  label: string;
  detail: string;
  color: string;
  pick: (focus: MapFocus) => void;
}

/** Every place on the map, in itinerary order: stays, then each day's stops, then flights. */
export function searchItems(route: Route): SearchItem[] {
  return [
    ...route.lodging.map((s) => ({ key: `stay:${s.id}`, label: s.label, detail: `Stay${s.detail ? ` · ${s.detail}` : ""}`, color: STAY_COLOR, pick: (f: MapFocus) => f.pickSpot(s.id) })),
    ...route.days.flatMap((d) =>
      d.stops.map((s) => ({
        key: `stop:${s.id}`,
        label: s.label,
        detail: `Day ${d.day} · Stop ${s.order}`,
        color: dayColor(d.day),
        pick: (f: MapFocus) => f.pick({ day: d.day, from: s.order!, to: s.order! }),
      })),
    ),
    ...route.flights.map((fl) => ({ key: `flight:${fl.id}`, label: fl.label, detail: "Flight", color: FLIGHT_COLOR, pick: (f: MapFocus) => f.pickSpot(fl.id, { day: null }) })),
  ];
}

/** Lowercase without accents, so "kyoto" finds "Kyōto". */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Items whose name (or day, or kind) contains every word typed. */
export function searchRoute(items: SearchItem[], query: string): SearchItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return items.filter((it) => {
    const text = fold(`${it.label} ${it.detail}`);
    return words.every((w) => text.includes(w));
  });
}

const MAX_RESULTS = 8;

/** Find a place on the map by name; picking one shows it there and marks it in the itinerary. */
function MapSearch({ route, focus }: { route: Route; focus: MapFocus }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = searchRoute(searchItems(route), query).slice(0, MAX_RESULTS);
  const showList = open && query.trim() !== "";

  const choose = (item: SearchItem) => {
    item.pick(focus);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="map-search">
      <input
        type="search"
        role="combobox"
        aria-label="Find a place on the map"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        placeholder="Find a place…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!results.length) return;
            setOpen(true);
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
          } else if (e.key === "Enter" && showList && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape" && showList) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {showList && (
        <ul className="map-search-list" role="listbox" id={listId} aria-label="Places">
          {results.length === 0 && <li className="map-search-empty">Nothing on the map by that name</li>}
          {results.map((it, i) => (
            <li
              key={it.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              // Keep focus in the box until the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(it)}
            >
              <span className="day-dot" style={{ background: it.color }} aria-hidden="true" />
              <span className="map-search-label">{it.label}</span>
              <span className="map-search-detail">{it.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Summary {
  title: string;
  detail: string | null;
  /** Picked stops can be cleared from the summary. */
  clearable: boolean;
}

/** What the map is showing, in words: the day or the picked stops, and the travel involved. */
export function summarize(
  route: Route,
  legs: LegLookup,
  day: number | null,
  range: StopRange | null,
  routing: boolean,
  spot: string | null = null,
): Summary | null {
  const stay = spot ? route.lodging.find((s) => s.id === spot) : undefined;
  if (stay) return { title: `Stay: ${stay.label}`, detail: stay.detail, clearable: true };
  const flight = spot ? route.flights.find((f) => f.id === spot) : undefined;
  if (flight) return { title: `Flight: ${flight.label}`, detail: null, clearable: true };
  const d = day === null ? null : route.days.find((x) => x.day === day);
  if (!d || d.stops.length === 0) return null;
  if (range && range.from === range.to) {
    const stop = d.stops[range.from - 1];
    return stop ? { title: `Day ${d.day} · Stop ${stop.order}: ${stop.label}`, detail: stop.detail, clearable: true } : null;
  }
  const stops = range ? d.stops.slice(range.from - 1, range.to) : dayStops(d);
  const title = range ? `Day ${d.day} · Stops ${range.from} → ${range.to}` : `Day ${d.day} · ${d.title}`;
  const count = range ? null : `${d.stops.length} stop${d.stops.length === 1 ? "" : "s"}`;
  let meters = 0;
  let seconds = 0;
  let known = true;
  for (let i = 1; i < stops.length; i++) {
    const leg = legs(stops[i - 1].place, stops[i].place);
    if (!leg) known = false;
    else {
      meters += leg.meters;
      seconds += leg.seconds;
    }
  }
  const travel =
    known && stops.length > 1 ? `${formatDuration(seconds)} getting around · ${formatDistance(meters)}` : routing ? "Finding the way…" : null;
  return { title, detail: [count, travel].filter(Boolean).join(" · ") || null, clearable: range !== null };
}

function MapView(props: {
  styleUrl: string;
  route: Route;
  legs: LegLookup;
  day: number | null;
  range: StopRange | null;
  spot: string | null;
  docked: boolean;
  focus: MapFocus;
  summary: Summary | null;
  /** Say how to use the map when nothing's picked. */
  hint: boolean;
}) {
  const { styleUrl, route, legs, day, range, spot, docked, focus, summary, hint } = props;
  const container = useRef<HTMLDivElement>(null);
  const lib = useRef<MapLibre | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const drawn = useRef(false);
  const framed = useRef("");
  // The pin whose popup is open, so a redraw (routes arriving, say) keeps it open.
  const openPin = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Declared before the map is created so that, on unmount, overlays are
  // removed before the map itself.
  useEffect(() => {
    if (!ready || !lib.current || !map.current) return;
    // Docking changes the map's size; fit to the new one.
    map.current.resize();
    // Reframe when the focus or the places change, not when routes come in:
    // jump on the first draw, glide after that.
    const frame = JSON.stringify([day, range, spot, docked, route.points.length]);
    const fit = frame !== framed.current;
    framed.current = frame;
    const undraw = draw(lib.current, map.current, { route, legs, day, range, spot, focus, fit, animate: drawn.current, openPin });
    drawn.current = true;
    return undraw;
  }, [ready, route, legs, day, range, spot, docked, focus]);

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl")
      .then((ml) => {
        if (cancelled || !container.current) return;
        let m: MapLibreMap;
        try {
          m = new ml.Map({
            container: container.current,
            style: styleUrl,
            center: [0, 20],
            zoom: 1,
            // The itinerary pane scrolls; zoom with ctrl/⌘ + scroll or two fingers.
            cooperativeGestures: true,
            attributionControl: { compact: true, customAttribution: "Routes: OSRM / FOSSGIS" },
          });
        } catch {
          setError("This browser can't show the map (WebGL is turned off or unsupported).");
          return;
        }
        m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        m.on("load", () => !cancelled && setReady(true));
        lib.current = ml;
        map.current = m;
      })
      .catch(() => !cancelled && setError("Couldn't load the map."));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      drawn.current = false;
      framed.current = "";
      setReady(false);
    };
  }, [styleUrl]);

  return (
    <div className="map-frame">
      <div ref={container} className="map-canvas" aria-label="Trip route map" role="region" />
      {summary ? (
        <div className="map-summary" aria-live="polite">
          <span className="map-summary-text">
            <strong>{summary.title}</strong>
            {summary.detail && <span>{summary.detail}</span>}
          </span>
          {summary.clearable && (
            <button className="link-btn" onClick={() => (spot ? focus.pickSpot(null) : focus.pick(null))}>
              Clear
            </button>
          )}
        </div>
      ) : (
        hint && <p className="map-summary map-hint">Select any item in the itinerary to locate it on the map.</p>
      )}
      {error && <div className="map-error">{error}</div>}
    </div>
  );
}

interface DrawOptions {
  route: Route;
  legs: LegLookup;
  day: number | null;
  range: StopRange | null;
  /** A picked stay or flight. */
  spot: string | null;
  focus: MapFocus;
  /** Fit the view to what's shown (and open a picked stop's popup). */
  fit: boolean;
  animate: boolean;
  openPin: { current: string | null };
}

const inRange = (stop: Stop, range: StopRange | null) =>
  range === null || (stop.kind === "activity" && stop.day === range.day && stop.order! >= range.from && stop.order! <= range.to);

/** Draws the route; returns a function that removes it again. */
function draw(ml: MapLibre, m: MapLibreMap, { route, legs, day, range, spot, focus, fit, animate, openPin }: DrawOptions): () => void {
  const markers: Marker[] = [];
  const layers: string[] = [];
  const sources: string[] = [];
  const cleanups: (() => void)[] = [];
  // What to fit the view to: the places on the ground. Flights would zoom out
  // to an ocean with the whole trip in one dot; they're included only when
  // nothing else is mapped. Picked stops narrow it to just them.
  const ground: [number, number][] = [];
  const air: [number, number][] = [];
  const picked: [number, number][] = [];
  const days = day === null ? route.days : route.days.filter((d) => d.day === day);

  // Keep every point within 180° of the trip itself, so a flight across the
  // Pacific is drawn across the Pacific rather than the long way round.
  const home = days.find((d) => d.stops.length)?.stops[0].place ?? route.lodging[0]?.place;
  const ref = home?.lng ?? 0;
  const lngLat = (p: { lat: number; lng: number }, around = ref): [number, number] => [unwrapLng(p.lng, around), p.lat];

  const pinned = new Map<string, Marker>();
  const marker = (stop: Stop, el: HTMLElement, at: [number, number] = lngLat(stop.place), item = stop.id) => {
    const popup = new ml.Popup({ offset: 16, maxWidth: "240px" }).setDOMContent(infoContent(stop, focus, item));
    const mk = new ml.Marker({ element: el }).setLngLat(at).setPopup(popup).addTo(m);
    markers.push(mk);
    pinned.set(`${stop.kind}:${stop.id}`, mk);
    (stop.kind === "airport" ? air : ground).push(at);
    return mk;
  };

  const addLayer = (id: string, source: string, paint: Record<string, unknown>, filter?: unknown[]) => {
    m.addLayer({ id, type: "line", source, layout: { "line-cap": "round", "line-join": "round" }, paint, ...(filter ? { filter } : {}) } as never);
    layers.push(id);
  };

  let open: Marker | null = null;
  // Stays and airports light up with their row in the itinerary, and clicking one picks it (again lets go).
  const spotPin = (el: HTMLElement, item: string, at: [number, number]) => {
    cleanups.push(focus.registerPin(item, el));
    el.addEventListener("mouseenter", () => focus.hover(item));
    el.addEventListener("mouseleave", () => focus.hover(null));
    el.addEventListener("click", () => focus.pickSpot(spot === item ? null : item));
    if (spot === item) {
      el.classList.add("picked");
      picked.push(at);
    }
  };

  // Stays: each once, for all days or for the selected day's night.
  const stays = day === null ? route.lodging : days.flatMap((d) => (d.lodging ? [d.lodging] : []));
  for (const stop of new Set(stays)) {
    const el = pin(lineIcon(BED_PATHS), STAY_COLOR, `Stay: ${stop.label}`);
    const mk = marker(stop, el);
    spotPin(el, stop.id, lngLat(stop.place));
    if (spot === stop.id) open = mk;
  }

  // Flights only in the all-days view: they'd dwarf a single day's route.
  if (day === null) {
    route.flights.forEach((f, i) => {
      const [first, ...rest] = greatCircle(f.from.place, f.to.place);
      const start = lngLat(first);
      const path: [number, number][] = [start, ...rest.map((p): [number, number] => [p.lng + (start[0] - first.lng), p.lat])];
      const id = `planaway-flight-${i}`;
      m.addSource(id, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path } } });
      sources.push(id);
      const width = spot === f.id ? 3.5 : 2;
      addLayer(id, id, { "line-color": spot === f.id ? STAY_COLOR : FLIGHT_COLOR, "line-width": width, "line-dasharray": [2, 2] });
      for (const [stop, at] of [
        [f.from, path[0]],
        [f.to, path[path.length - 1]],
      ] as const) {
        const el = pin(lineIcon(PLANE_PATHS), FLIGHT_COLOR, `Airport: ${stop.label}`);
        marker(stop, el, at, f.id);
        spotPin(el, f.id, at);
      }
    });
  }

  for (const d of days) {
    if (d.stops.length === 0) continue;
    const color = dayColor(d.day);
    const id = `planaway-day-${d.day}`;
    m.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: dayFeatures(d, legs, range, lngLat) } });
    sources.push(id);
    const width = range ? ["case", ["get", "active"], 6, 3] : 4;
    const opacity = range ? ["case", ["get", "active"], 0.95, 0.25] : 0.85;
    addLayer(id, id, { "line-color": color, "line-width": width, "line-opacity": opacity }, ["==", ["get", "routed"], true]);
    addLayer(`${id}-straight`, id, { "line-color": color, "line-width": width, "line-opacity": opacity, "line-dasharray": [1.5, 1.5] }, [
      "==",
      ["get", "routed"],
      false,
    ]);

    for (const stop of d.stops) {
      const el = pin(String(stop.order), color, `Day ${d.day}, stop ${stop.order}: ${stop.label}`);
      if (!inRange(stop, range)) el.classList.add("dim");
      const mk = marker(stop, el);
      if (inRange(stop, range) && range) picked.push(lngLat(stop.place));
      if (range && range.from === range.to && range.from === stop.order && range.day === d.day) open = mk;
      cleanups.push(focus.registerPin(stop.id, el));
      el.addEventListener("mouseenter", () => focus.hover(stop.id));
      el.addEventListener("mouseleave", () => focus.hover(null));
      // Picking a pin marks it in the timeline too; picking it again lets it go.
      el.addEventListener("click", () => {
        const only = range && range.day === d.day && range.from === stop.order && range.to === stop.order;
        focus.pick(only ? null : { day: d.day, from: stop.order!, to: stop.order! });
      });
    }

    // On one day, label each leg with how long it takes.
    if (day !== null) {
      const stops = dayStops(d);
      for (let i = 1; i < stops.length; i++) {
        const [a, b] = [stops[i - 1], stops[i]];
        const leg = legs(a.place, b.place);
        if (!leg || leg.meters === 0 || (range && !(inRange(a, range) && inRange(b, range)))) continue;
        const el = document.createElement("div");
        el.className = "map-leg";
        el.textContent = legLabel(leg);
        const [lng, lat] = leg.path[Math.floor(leg.path.length / 2)];
        markers.push(new ml.Marker({ element: el }).setLngLat([unwrapLng(lng, ref), lat]).addTo(m));
      }
    }
  }

  const coords = picked.length ? picked : ground.length ? ground : air;
  if (fit && coords.length) {
    const bounds = coords.reduce((b, c) => b.extend(c), new ml.LngLatBounds(coords[0], coords[0]));
    m.fitBounds(bounds, { padding: 56, maxZoom: picked.length === 1 ? 16 : 15, duration: animate ? 600 : 0 });
  }
  // A new focus opens only a picked stop's popup; a plain redraw keeps whatever was open.
  const reopen = fit ? open : openPin.current ? pinned.get(openPin.current) : undefined;
  if (reopen && !reopen.getPopup()?.isOpen()) reopen.togglePopup();

  return () => {
    for (const fn of cleanups) fn();
    openPin.current = [...pinned].find(([, mk]) => mk.getPopup()?.isOpen())?.[0] ?? null;
    for (const mk of markers) mk.remove();
    for (const id of layers) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of sources) if (m.getSource(id)) m.removeSource(id);
  };
}

/** A day's legs as lines: along the streets once routed, straight until then. */
function dayFeatures(d: DayRoute, legs: LegLookup, range: StopRange | null, lngLat: (p: { lat: number; lng: number }) => [number, number]) {
  const stops = dayStops(d);
  return stops.slice(1).map((b, i) => {
    const a = stops[i];
    const leg = legs(a.place, b.place);
    const routed = !!leg && leg.path.length > 1;
    const coordinates = routed ? leg.path.map(([lng, lat]) => lngLat({ lat, lng })) : [lngLat(a.place), lngLat(b.place)];
    const active = range !== null && inRange(a, range) && inRange(b, range);
    return { type: "Feature" as const, properties: { routed, active }, geometry: { type: "LineString" as const, coordinates } };
  });
}

/**
 * A round marker; `label` names it for screen readers and on hover. Built with
 * DOM APIs: labels come from the web, so no innerHTML.
 */
function pin(content: string | SVGElement, color: string, label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "map-pin";
  el.style.background = color;
  el.append(content);
  el.title = label;
  // MapLibre names every marker "Map marker" unless one is set.
  el.setAttribute("aria-label", label);
  return el;
}

/** A pin's popup; `item` is the itinerary entry it belongs to (a flight, for an airport). */
/** A small line icon for a pin, from the app's own drawings (components/icons). */
function lineIcon(paths: string[]): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }))
    svg.setAttribute(k, v);
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function infoContent(stop: Stop, focus: MapFocus, item: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "map-info";
  const photo = stop.place.photos[0];
  if (photo) {
    const img = document.createElement("img");
    img.src = photo.thumb;
    img.alt = "";
    img.onerror = () => img.remove();
    root.append(img);
  }
  const title = document.createElement("strong");
  title.textContent = stop.kind === "activity" ? `${stop.order}. ${stop.label}` : stop.label;
  root.append(title);
  const sub = [stop.day !== null ? `Day ${stop.day}` : null, stop.detail].filter(Boolean).join(" · ");
  if (sub) {
    const el = document.createElement("div");
    el.className = "map-info-sub";
    el.textContent = sub;
    root.append(el);
  }
  if (stop.place.guess) {
    const el = document.createElement("div");
    el.className = "map-info-sub";
    el.textContent = `Closest match: ${stop.place.name}`;
    root.append(el);
  }
  const links = document.createElement("div");
  links.className = "map-info-links";
  const show = document.createElement("button");
  show.type = "button";
  show.className = "link-btn";
  show.textContent = "Show in itinerary";
  show.addEventListener("click", () => focus.reveal(item));
  links.append(show);
  const href = safeUrl(stop.place.mapsUrl);
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "OpenStreetMap ↗";
    links.append(a);
  }
  if (links.childElementCount) root.append(links);
  if (photo) {
    const el = document.createElement("div");
    el.className = "photo-credit";
    el.textContent = credit(photo);
    root.append(el);
  }
  return root;
}
