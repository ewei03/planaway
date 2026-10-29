"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildRoute, dayPath, greatCircle, unwrapLng, type Route, type Stop } from "@/lib/route";
import { safeUrl, type Itinerary } from "./client";
import { credit, useMapsConfig, type PlaceLookup } from "./places";

// The route map: numbered stops and a line per day, stays, and flights. It's
// drawn from `buildRoute`, so it follows the itinerary on screen, including
// live revisions while the agent works and saved versions. Drawn with
// MapLibre on OpenFreeMap tiles (OpenStreetMap data): free, no API key.

/** One color per day, cycling. */
export const DAY_COLORS = ["#0f6e63", "#c2410c", "#4f46e5", "#b91c1c", "#0369a1", "#a16207", "#7e22ce", "#be185d"];
export const dayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length];

type MapLibre = typeof import("maplibre-gl");

interface Props {
  itinerary: Itinerary;
  lookup: PlaceLookup;
  loading: boolean;
}

export function TripMap({ itinerary, lookup, loading }: Props) {
  const { styleUrl } = useMapsConfig();
  const route = useMemo(() => buildRoute(itinerary, lookup), [itinerary, lookup]);
  const [day, setDay] = useState<number | null>(null);
  const mappedDays = route.days.filter((d) => d.stops.length > 0);

  // Forget a selected day that no longer exists after a revision.
  useEffect(() => {
    if (day !== null && !route.days.some((d) => d.day === day && d.stops.length > 0)) setDay(null);
  }, [day, route]);

  return (
    <div className="trip-map">
      {mappedDays.length > 1 && (
        <div className="map-days" role="group" aria-label="Show day on map">
          <button className={`chip-btn ${day === null ? "active" : ""}`} aria-pressed={day === null} onClick={() => setDay(null)}>
            All days
          </button>
          {mappedDays.map((d) => (
            <button
              key={d.day}
              className={`chip-btn ${day === d.day ? "active" : ""}`}
              aria-pressed={day === d.day}
              title={d.title}
              onClick={() => setDay(d.day)}
            >
              <span className="day-dot" style={{ background: dayColor(d.day) }} aria-hidden="true" />
              Day {d.day}
            </button>
          ))}
        </div>
      )}
      <MapView styleUrl={styleUrl} route={route} day={day} />
      {loading && <div className="map-status muted small">Finding places…</div>}
      {!loading && route.points.length === 0 && <div className="map-status muted small">No places to show yet.</div>}
    </div>
  );
}

function MapView({ styleUrl, route, day }: { styleUrl: string; route: Route; day: number | null }) {
  const container = useRef<HTMLDivElement>(null);
  const lib = useRef<MapLibre | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Declared before the map is created so that, on unmount, overlays are
  // removed before the map itself.
  useEffect(() => {
    if (!ready || !lib.current || !map.current) return;
    return draw(lib.current, map.current, route, day);
  }, [ready, route, day]);

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
            attributionControl: { compact: true },
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
      setReady(false);
    };
  }, [styleUrl]);

  return (
    <div className="map-frame">
      <div ref={container} className="map-canvas" aria-label="Trip route map" role="region" />
      {error && <div className="map-error">{error}</div>}
    </div>
  );
}

/** Draws the route; returns a function that removes it again. */
function draw(ml: MapLibre, m: MapLibreMap, route: Route, selected: number | null): () => void {
  const markers: Marker[] = [];
  const layers: string[] = [];
  // What to fit the view to: the places on the ground. Flights would zoom out
  // to an ocean with the whole trip in one dot; they're included only when
  // nothing else is mapped.
  const ground: [number, number][] = [];
  const air: [number, number][] = [];
  const days = selected === null ? route.days : route.days.filter((d) => d.day === selected);

  // Keep every point within 180° of the trip itself, so a flight across the
  // Pacific is drawn across the Pacific rather than the long way round.
  const home = days.find((d) => d.stops.length)?.stops[0].place ?? route.lodging[0]?.place;
  const ref = home?.lng ?? 0;
  const lngLat = (p: { lat: number; lng: number }, around = ref): [number, number] => [unwrapLng(p.lng, around), p.lat];

  const marker = (stop: Stop, el: HTMLElement, at: [number, number] = lngLat(stop.place)) => {
    const popup = new ml.Popup({ offset: 16, maxWidth: "240px" }).setDOMContent(infoContent(stop));
    markers.push(new ml.Marker({ element: el }).setLngLat(at).setPopup(popup).addTo(m));
    (stop.kind === "airport" ? air : ground).push(at);
  };

  const line = (id: string, coordinates: [number, number][], paint: Record<string, unknown>) => {
    m.addSource(id, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } } });
    m.addLayer({ id, type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint });
    layers.push(id);
  };

  // Stays: each once, for all days or for the selected day's night.
  const stays = selected === null ? route.lodging : days.flatMap((d) => (d.lodging ? [d.lodging] : []));
  for (const stop of new Set(stays)) marker(stop, pin("🛏", "#1d1c1a", `Stay: ${stop.label}`));

  // Flights only in the all-days view: they'd dwarf a single day's route.
  if (selected === null) {
    route.flights.forEach((f, i) => {
      const [first, ...rest] = greatCircle(f.from.place, f.to.place);
      const start = lngLat(first);
      const path: [number, number][] = [start, ...rest.map((p): [number, number] => [p.lng + (start[0] - first.lng), p.lat])];
      line(`planaway-flight-${i}`, path, { "line-color": "#6b6860", "line-width": 2, "line-dasharray": [2, 2] });
      marker(f.from, pin("✈", "#6b6860", `Airport: ${f.from.label}`), path[0]);
      marker(f.to, pin("✈", "#6b6860", `Airport: ${f.to.label}`), path[path.length - 1]);
    });
  }

  for (const d of days) {
    if (d.stops.length === 0) continue;
    const color = dayColor(d.day);
    line(`planaway-day-${d.day}`, dayPath(d).map((p) => lngLat(p)), { "line-color": color, "line-width": 4, "line-opacity": 0.85 });
    for (const stop of d.stops) marker(stop, pin(String(stop.order), color, `Day ${d.day}, stop ${stop.order}: ${stop.label}`));
  }

  const coords = ground.length ? ground : air;
  if (coords.length) {
    const bounds = coords.reduce((b, c) => b.extend(c), new ml.LngLatBounds(coords[0], coords[0]));
    m.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }

  return () => {
    for (const mk of markers) mk.remove();
    for (const id of layers) {
      if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(id)) m.removeSource(id);
    }
  };
}

/**
 * A round marker; `label` names it for screen readers and on hover. Built with
 * DOM APIs: labels come from the web, so no innerHTML.
 */
function pin(text: string, color: string, label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "map-pin";
  el.style.background = color;
  el.textContent = text;
  el.title = label;
  // MapLibre names every marker "Map marker" unless one is set.
  el.setAttribute("aria-label", label);
  return el;
}

function infoContent(stop: Stop): HTMLElement {
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
  const href = safeUrl(stop.place.mapsUrl);
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open in OpenStreetMap ↗";
    root.append(a);
  }
  if (photo) {
    const el = document.createElement("div");
    el.className = "photo-credit";
    el.textContent = credit(photo);
    root.append(el);
  }
  return root;
}
