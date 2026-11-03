"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PlaceSuggestion, SuggestionKind } from "@/lib/placeSearch";
import { api } from "./client";

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

const KIND_LABELS: Record<SuggestionKind, string> = {
  airport: "Airport",
  city: "City",
  region: "Region",
  address: "Address",
  place: "Place",
};

/**
 * A text box that suggests airports, cities, and addresses as you type.
 * Picking one fills in its full name. onChange says whether the value came
 * from the list, so a form can insist on a real place.
 */
export function PlaceInput({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string, picked: boolean) => void;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
  /** The id of a message about the field, such as an error. */
  describedBy?: string;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  /** Only typing searches; picking a suggestion shouldn't search for it again. */
  const [query, setQuery] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query?.trim() ?? "";
    if (q.length < MIN_QUERY) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { suggestions } = await api<{ suggestions: PlaceSuggestion[] }>(`/api/places/suggest?${new URLSearchParams({ q })}`);
        if (!cancelled) {
          setSuggestions(suggestions);
          setActive(-1);
        }
      } catch {
        // Suggestions are a convenience: typing still works without them.
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const pick = (s: PlaceSuggestion) => {
    onChange(s.value, true);
    setQuery(null);
    setOpen(false);
  };

  const showList = open && query !== null && query.trim().length >= MIN_QUERY && (suggestions.length > 0 || !loading);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && showList) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!suggestions.length) return;
      e.preventDefault();
      setOpen(true);
      const last = suggestions.length - 1;
      setActive((i) => (e.key === "ArrowDown" ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1));
    } else if (e.key === "Enter" && showList && active >= 0 && suggestions[active]) {
      // Pick instead of submitting the form.
      e.preventDefault();
      pick(suggestions[active]);
    }
  };

  return (
    <div
      className="place-input"
      ref={boxRef}
      onBlur={(e) => {
        if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => {
          onChange(e.target.value, false);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => query !== null && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className="place-options" id={listId} role="listbox" aria-label="Suggestions">
          {suggestions.length === 0 ? (
            <li className="place-empty muted small" role="presentation">
              No matches. Try a city, an airport code, or a street address.
            </li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={s.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : undefined}
                // Keep focus in the input so blur doesn't close the list first.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(s)}
              >
                <span className="place-option-text">
                  <span className="place-option-label">{s.label}</span>
                  {s.detail && <span className="place-option-detail">{s.detail}</span>}
                </span>
                <span className={`place-kind kind-${s.kind}`}>{KIND_LABELS[s.kind]}</span>
              </li>
            ))
          )}
          {suggestions.length > 0 && (
            <li className="place-credit" role="presentation">
              Places from OpenStreetMap
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
