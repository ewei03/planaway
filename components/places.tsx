"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { normalizeQuery, placeQueries, type Place, type PlaceLookup, type PlacePhoto } from "@/lib/route";
import { api, safeUrl, type Itinerary } from "./client";

export type { Place, PlaceLookup, PlacePhoto };

// ---------- Configuration ----------

export interface MapsConfig {
  /** MapLibre style URL for the route map. */
  styleUrl: string;
}

const MapsContext = createContext<MapsConfig>({ styleUrl: "https://tiles.openfreemap.org/styles/liberty" });
export const MapsProvider = MapsContext.Provider;
export const useMapsConfig = () => useContext(MapsContext);

// ---------- Place lookups ----------

/** Lookups wait for the itinerary to settle while the agent streams revisions. */
const DEBOUNCE_MS = 400;
const BATCH = 80;

/**
 * Looks up the itinerary's places on the server, and again whenever the
 * itinerary gains places not seen before. The server answers a few new places
 * at a time (the free place search is rate-limited), so this keeps asking
 * until everything is found. Results accumulate, so switching versions or
 * small edits don't refetch.
 */
export function usePlaces(itinerary: Itinerary | null): { lookup: PlaceLookup; loading: boolean } {
  const [found, setFound] = useState<Map<string, Place | null>>(() => new Map());
  const failed = useRef(new Set<string>());

  const queries = useMemo(() => (itinerary ? placeQueries(itinerary) : []), [itinerary]);
  const missing = queries.filter((q) => !found.has(normalizeQuery(q)) && !failed.current.has(normalizeQuery(q)));
  const missingKey = missing.slice(0, BATCH).join("\n");

  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const batch = missingKey.split("\n");
      try {
        const { places } = await api<{ places: Record<string, Place | null> }>("/api/places", {
          method: "POST",
          body: JSON.stringify({ queries: batch }),
        });
        if (!cancelled) setFound((prev) => new Map([...prev, ...Object.entries(places)]));
      } catch {
        // Don't retry in a loop; the map and photos just stay as they are.
        if (!cancelled) {
          batch.forEach((q) => failed.current.add(normalizeQuery(q)));
          setFound((prev) => new Map(prev));
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [missingKey]);

  const lookup = useCallback<PlaceLookup>((q) => found.get(normalizeQuery(q)), [found]);
  return { lookup, loading: missing.length > 0 };
}

// ---------- Photos ----------

/** e.g. "Photo: Jane Doe, CC BY-SA 4.0". Commons licenses require the credit. */
export function credit(photo: PlacePhoto): string {
  const parts = [photo.author, photo.license].filter(Boolean).join(", ");
  return parts ? `Photo: ${parts}` : "Photo from Wikimedia Commons";
}

/** A place's photo as a thumbnail; click to open the photo viewer. Renders nothing without a photo. */
export function PlaceThumb({ place, label, size = 56 }: { place: Place | null | undefined; label: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const photo = place?.photos[0];
  if (!place || !photo || broken) return null;
  return (
    <>
      <button className="thumb" style={{ width: size, height: size }} aria-label={`Photos of ${label}`} title={credit(photo)} onClick={() => setOpen(true)}>
        <img src={photo.thumb} alt="" loading="lazy" onError={() => setBroken(true)} />
      </button>
      {open && <PhotoViewer place={place} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Wide photos for the trip header, with credits. */
export function HeroPhotos({ photos }: { photos: { place: Place; photo: PlacePhoto; label: string }[] }) {
  const [viewing, setViewing] = useState<{ place: Place; label: string } | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const shown = photos.filter((p) => !broken.has(p.photo.src)).slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <div className={`hero hero-${shown.length}`}>
      {shown.map(({ place, photo, label }) => (
        <figure key={photo.src}>
          <button className="hero-img" aria-label={`Photos of ${label}`} onClick={() => setViewing({ place, label })}>
            <img
              src={photo.src}
              alt={label}
              onError={() => setBroken((b) => new Set(b).add(photo.src))}
            />
          </button>
          <figcaption>
            <span className="hero-label">{label}</span>
            <Credit photo={photo} />
          </figcaption>
        </figure>
      ))}
      {viewing && <PhotoViewer place={viewing.place} label={viewing.label} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Credit({ photo }: { photo: PlacePhoto }) {
  const href = safeUrl(photo.sourceUrl);
  const text = credit(photo);
  return (
    <span className="photo-credit">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      ) : (
        text
      )}
    </span>
  );
}

/** A modal gallery of a place's photos, with credits and an OpenStreetMap link. */
export function PhotoViewer({ place, label, onClose }: { place: Place; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const photo = place.photos[index];
  const mapsUrl = safeUrl(place.mapsUrl);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const step = (d: number) => setIndex((i) => (i + d + place.photos.length) % place.photos.length);

  return (
    <dialog
      ref={ref}
      className="dialog photo-viewer"
      aria-label={`Photos of ${label}`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <div className="dialog-head">
        <h2>{label}</h2>
        <button className="btn icon" aria-label="Close" onClick={() => ref.current?.close()}>
          ✕
        </button>
      </div>
      {photo && <img className="viewer-img" src={photo.src} alt={`${label}, photo ${index + 1} of ${place.photos.length}`} />}
      <div className="viewer-foot">
        {place.photos.length > 1 && (
          <div className="viewer-nav">
            <button className="btn icon" aria-label="Previous photo" onClick={() => step(-1)}>
              ‹
            </button>
            <span className="muted small">
              {index + 1} / {place.photos.length}
            </span>
            <button className="btn icon" aria-label="Next photo" onClick={() => step(1)}>
              ›
            </button>
          </div>
        )}
        {photo && <Credit photo={photo} />}
        {place.address && <span className="muted small">{place.address}</span>}
        {mapsUrl && (
          <a className="small" href={mapsUrl} target="_blank" rel="noopener noreferrer">
            Open in OpenStreetMap ↗
          </a>
        )}
      </div>
    </dialog>
  );
}
