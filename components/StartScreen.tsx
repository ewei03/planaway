"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { areaQuery } from "@/lib/route";
import { isCurrencyCode } from "@/lib/currencies";
import type { TripDefaults } from "@/lib/settings";
import { CurrencySelect } from "./CurrencySelect";
import { ArrowRightIcon, DiceIcon, MenuIcon } from "./icons";
import { credit, type PlaceLookup } from "./places";
import { SiteFooter } from "./SiteFooter";

/** Starting points under the idea box. `place` is looked up for the card's photo. */
export const INSPIRATION = [
  {
    place: "Lisbon",
    title: "Tiles and tascas in Lisbon",
    meta: "4 days · Food · Culture",
    prompt: "4 days in Lisbon for two: tiled old neighborhoods, viewpoints, and lots of good food.",
    tint: "#BFD9E6",
  },
  {
    place: "Tromsø",
    title: "Northern lights in Tromsø",
    meta: "5 days · Winter · Nature",
    prompt: "5 days in Tromsø in February to see the northern lights, with a fjord trip and a husky ride.",
    tint: "#C8CDEB",
  },
  {
    place: "Kyoto",
    title: "Temples and izakayas in Kyoto",
    meta: "6 days · Food · History",
    prompt: "6 days in Kyoto: temples and gardens by day, izakayas and markets by night.",
    tint: "#E8C3A8",
  },
  {
    place: "Torres del Paine",
    title: "Hiking Torres del Paine",
    meta: "8 days · Hiking · Outdoors",
    prompt: "8 days hiking in Torres del Paine, Patagonia, staying in refugios along the W Trek.",
    tint: "#C9DCC4",
  },
  {
    place: "Marrakech",
    title: "Souks and riads in Marrakech",
    meta: "4 days · Markets · Design",
    prompt: "4 days in Marrakech staying in a riad, with the souks, gardens, and a day trip to the Atlas Mountains.",
    tint: "#F0D9A8",
  },
  {
    place: "Oaxaca",
    title: "Mezcal and markets in Oaxaca",
    meta: "5 days · Food · Craft",
    prompt: "5 days in Oaxaca for food lovers: markets, mezcal, cooking classes, and craft villages.",
    tint: "#E6CBE0",
  },
] as const;

export const INSPIRATION_QUERIES = INSPIRATION.map((i) => areaQuery(i.place));

function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return "Good evening";
  return hour < 12 ? "Good morning" : "Good afternoon";
}

const INTERESTS = [
  ["food & drink", "Food & drink"],
  ["history & museums", "History & museums"],
  ["nature & hiking", "Nature & hiking"],
  ["beaches", "Beaches"],
  ["nightlife", "Nightlife"],
  ["art & architecture", "Art & architecture"],
  ["adventure sports", "Adventure"],
  ["shopping", "Shopping"],
  ["off the beaten path", "Off the beaten path"],
  ["family-friendly", "Family-friendly"],
] as const;


interface BuildForm {
  origin: string;
  travelers: string;
  budget: string;
  currency: string;
  length: string;
  when: string;
  pace: string;
  interests: string[];
  destination: string;
  notes: string;
}

const EMPTY_FORM: BuildForm = {
  origin: "",
  travelers: "2",
  budget: "",
  currency: "USD",
  length: "",
  when: "",
  pace: "balanced",
  interests: [],
  destination: "",
  notes: "",
};

/** The empty form, with the user's saved defaults filled in where they have them. */
function formFromDefaults(d: TripDefaults | undefined): BuildForm {
  if (!d) return EMPTY_FORM;
  return {
    ...EMPTY_FORM,
    origin: d.origin ?? EMPTY_FORM.origin,
    travelers: d.travelers ? String(d.travelers) : EMPTY_FORM.travelers,
    currency: d.currency && isCurrencyCode(d.currency) ? d.currency : EMPTY_FORM.currency,
    pace: d.pace ?? EMPTY_FORM.pace,
  };
}

/** Shared trip constraints: origin, party size, budget, length, timing. */
function constraintLines(f: BuildForm): string[] {
  const lines: string[] = [];
  if (f.origin.trim()) lines.push(`Leaving from: ${f.origin.trim()}.`);
  lines.push(`Travelers: ${Number(f.travelers) || 1}.`);
  if (f.budget.trim()) lines.push(`Total budget: ${f.budget.trim()} ${f.currency}, including flights and lodging.`);
  if (f.length.trim()) lines.push(`Trip length: ${f.length.trim()} days.`);
  if (f.when.trim()) lines.push(`When: ${f.when.trim()}.`);
  return lines;
}

function buildPrompt(f: BuildForm): string {
  const lines = ["Build a vacation plan for me."];
  lines.push(
    f.destination.trim()
      ? `Destination ideas: ${f.destination.trim()}.`
      : "I don't have a destination in mind; pick one that fits what I like and explain why you chose it.",
  );
  lines.push(...constraintLines(f), `Pace: ${f.pace}.`);
  if (f.interests.length) lines.push(`Interests: ${f.interests.join(", ")}.`);
  if (f.notes.trim()) lines.push(`Other notes: ${f.notes.trim()}`);
  return lines.join("\n");
}

/**
 * Where Surprise me looks. A model asked to "pick at random" lands on the same
 * few favorites every time, so the app picks the region or theme itself and
 * leaves the model to choose a specific place within it.
 */
export const SURPRISE_THEMES = [
  "a lesser-known city in Eastern Europe",
  "a mountain town in the Alps or the Dolomites",
  "a small Greek island off the usual ferry routes",
  "the Atlantic coast of Spain or Portugal",
  "a region of Italy beyond Rome, Florence, and Venice",
  "the Baltic states",
  "the Balkans",
  "Scotland or Ireland beyond the capitals",
  "Scandinavia or Finland",
  "a volcanic island in the Atlantic (the Azores, the Canaries, Madeira, or Iceland)",
  "the Caucasus (Georgia or Armenia)",
  "Central Asia along the Silk Road",
  "Japan beyond Tokyo and Kyoto",
  "South Korea or Taiwan",
  "Vietnam, Laos, or Cambodia",
  "an island in Indonesia or the Philippines",
  "Sri Lanka or southern India",
  "the Himalayas (Nepal, Bhutan, or northern India)",
  "Malaysia or Singapore",
  "Morocco or Tunisia",
  "a safari region in East or Southern Africa",
  "a coastal town in West Africa",
  "the islands of the Indian Ocean",
  "Jordan or Egypt",
  "Patagonia",
  "the Andes (Peru, Bolivia, or Ecuador)",
  "Colombia",
  "Mexico beyond the beach resorts",
  "Central America",
  "the Caribbean, away from the cruise ports",
  "a road trip through a US national park region",
  "a small US city with a big food scene",
  "Canada's East Coast or the Rockies",
  "New Zealand",
  "Australia beyond Sydney and Melbourne",
  "a Pacific island (Fiji, Samoa, or French Polynesia)",
] as const;

/** One theme, chosen fresh on each click. */
export function pickSurpriseTheme(random = Math.random): string {
  return SURPRISE_THEMES[Math.floor(random() * SURPRISE_THEMES.length)];
}

function surprisePrompt(f: BuildForm, theme: string, avoid: string[]): string {
  return [
    `Surprise me! Pick a destination for me in ${theme}: somewhere interesting I probably wouldn't think of myself, that fits the details below. Then build the whole trip.`,
    ...(avoid.length ? [`I've already planned trips to ${avoid.join(", ")}, so pick somewhere else.`] : []),
    ...constraintLines(f),
  ].join("\n");
}

interface Props {
  onStart: (prompt: string) => Promise<void>;
  onOpenSidebar: () => void;
  /** The signed-in user's name, for the greeting. */
  userName?: string;
  /** Place photos for the inspiration cards. */
  lookup?: PlaceLookup;
  /** The user's saved trip defaults, which pre-fill the Plan it for me form. */
  defaults?: TripDefaults;
  /** Destinations of the user's trips, which Surprise me steers away from. */
  pastDestinations?: string[];
  /** Title of the trip PlanAway is still planning; starting another waits for it. */
  busyWith?: string | null;
  onOpenBusy?: () => void;
}

export function StartScreen({ onStart, onOpenSidebar, userName, lookup, defaults, pastDestinations = [], busyWith = null, onOpenBusy }: Props) {
  const [tab, setTab] = useState<"idea" | "build">("idea");
  const [idea, setIdea] = useState("");
  const [form, setForm] = useState<BuildForm>(() => formFromDefaults(defaults));
  const [starting, setStarting] = useState(false);
  // Set after mount: the server doesn't know the viewer's time of day.
  const [hello, setHello] = useState("Welcome back");
  const ideaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setHello(greeting(new Date().getHours())), []);

  const pickInspiration = (prompt: string) => {
    setTab("idea");
    setIdea(prompt);
    // The textarea mounts with the tab, so focus it on the next frame.
    requestAnimationFrame(() => ideaRef.current?.focus());
  };

  const set = <K extends keyof BuildForm>(key: K, value: BuildForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleInterest = (value: string) =>
    set("interests", form.interests.includes(value) ? form.interests.filter((i) => i !== value) : [...form.interests, value]);

  const start = async (prompt: string) => {
    if (starting) return;
    setStarting(true);
    try {
      await onStart(prompt);
    } finally {
      setStarting(false);
    }
  };

  const submitIdea = (e: FormEvent) => {
    e.preventDefault();
    if (idea.trim()) start(idea.trim());
  };
  const submitBuild = (e: FormEvent) => {
    e.preventDefault();
    start(buildPrompt(form));
  };

  return (
    <section className="start">
      <div className="start-inner">
        <button className="btn mobile-only open-sidebar" id="start-show-sidebar" onClick={onOpenSidebar}>
          <MenuIcon size={16} /> Your trips
        </button>
        <p className="eyebrow">
          {hello}
          {userName ? `, ${userName.split(" ")[0]}` : ""}
        </p>
        <h1>Where to next?</h1>
        <p className="muted start-lede">
          Describe a trip you have in mind, or tell PlanAway what you like and let it plan one for you. It researches
          flights, stays, and things to do on the web, then builds an itinerary you can refine together.
        </p>

        {busyWith && (
          <p className="busy-note" role="status">
            PlanAway is still working on “{busyWith}”. You can start another trip when it finishes.{" "}
            {onOpenBusy && (
              <button type="button" className="link-btn" onClick={onOpenBusy}>
                View progress
              </button>
            )}
          </p>
        )}

        <div className="tabs" role="tablist">
          {(
            [
              ["idea", "I have an idea"],
              ["build", "Plan it for me"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              className={`tab ${tab === key ? "active" : ""}`}
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "idea" ? (
          <form className="card" onSubmit={submitIdea}>
            <label htmlFor="idea-text">Your trip idea</label>
            <textarea
              id="idea-text"
              ref={ideaRef}
              rows={4}
              required
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. 10 days in Japan next April for two, Tokyo and Kyoto, love food and design, about $6,000 total from San Francisco"
            />
            <div className="form-actions">
              <button
                className="btn surprise big"
                type="button"
                disabled={starting || Boolean(busyWith)}
                // No form here, so the trip starts from the saved defaults alone.
                onClick={() => start(surprisePrompt(formFromDefaults(defaults), pickSurpriseTheme(), pastDestinations))}
              >
                <DiceIcon /> Surprise me!
              </button>
              <button className="btn primary big" type="submit" disabled={starting || Boolean(busyWith)}>
                Plan my trip <ArrowRightIcon size={16} />
              </button>
            </div>
            {/* <p className="hint muted">
              No idea yet? <b>Surprise me!</b> picks a destination at random and plans the whole trip, using your trip defaults from Settings.
            </p> */}
          </form>
        ) : (
          <form className="card" onSubmit={submitBuild}>
            <div className="grid">
              <div>
                <label htmlFor="b-origin">Leaving from</label>
                <input id="b-origin" placeholder="City or airport" value={form.origin} onChange={(e) => set("origin", e.target.value)} />
              </div>
              <div>
                <label htmlFor="b-travelers">Travelers</label>
                <input id="b-travelers" type="number" min={1} value={form.travelers} onChange={(e) => set("travelers", e.target.value)} />
              </div>
              <div>
                <label htmlFor="b-budget">Total budget</label>
                <div className="inline">
                  <input id="b-budget" type="number" min={0} step={100} placeholder="3000" value={form.budget} onChange={(e) => set("budget", e.target.value)} />
                  <CurrencySelect codeOnly aria-label="Currency" value={form.currency} onChange={(e) => set("currency", e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="b-length">Trip length (days)</label>
                <input id="b-length" type="number" min={1} placeholder="7" value={form.length} onChange={(e) => set("length", e.target.value)} />
              </div>
              <div>
                <label htmlFor="b-when">When</label>
                <input id="b-when" placeholder="e.g. mid-June, or 2027-03-10 to 2027-03-17" value={form.when} onChange={(e) => set("when", e.target.value)} />
              </div>
              <div>
                <label htmlFor="b-pace">Pace</label>
                <select id="b-pace" value={form.pace} onChange={(e) => set("pace", e.target.value)}>
                  <option value="balanced">Balanced</option>
                  <option value="relaxed">Relaxed</option>
                  <option value="packed">Packed</option>
                </select>
              </div>
            </div>

            <fieldset>
              <legend>Interests</legend>
              <div className="chips">
                {INTERESTS.map(([value, label]) => (
                  <label key={value}>
                    <input type="checkbox" checked={form.interests.includes(value)} onChange={() => toggleInterest(value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label htmlFor="b-dest">
              Destination ideas <span className="muted">(optional)</span>
            </label>
            <input id="b-dest" placeholder="Leave blank and PlanAway will pick" value={form.destination} onChange={(e) => set("destination", e.target.value)} />

            <label htmlFor="b-notes">
              Anything else? <span className="muted">(optional)</span>
            </label>
            <textarea
              id="b-notes"
              rows={2}
              placeholder="Dietary needs, mobility, must-sees, things to avoid…"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />

            <div className="form-actions">
              <button className="btn primary big" type="submit" disabled={starting || Boolean(busyWith)}>
                Build my trip <ArrowRightIcon size={16} />
              </button>
            </div>
          </form>
        )}

        <section className="inspiration" aria-labelledby="inspiration-heading">
          <div className="inspiration-head">
            <h2 id="inspiration-heading">Need inspiration?</h2>
            <span className="muted small">Pick one to start from it</span>
          </div>
          <div className="inspiration-grid">
            {INSPIRATION.map((i, n) => (
              <InspirationCard key={i.place} idea={i} order={n} lookup={lookup} onPick={() => pickInspiration(i.prompt)} />
            ))}
          </div>
        </section>
      </div>
      <SiteFooter />
    </section>
  );
}

function InspirationCard({
  idea,
  order,
  lookup,
  onPick,
}: {
  idea: (typeof INSPIRATION)[number];
  /** Position in the grid, which staggers the cards' fade-in. */
  order: number;
  lookup?: PlaceLookup;
  onPick: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const photo = lookup?.(areaQuery(idea.place))?.photos[0];
  return (
    <button type="button" className="inspiration-card" style={{ "--i": order } as CSSProperties} onClick={onPick}>
      <span className="inspiration-photo" style={{ background: idea.tint }} title={photo && !broken ? credit(photo) : undefined}>
        {photo && !broken ? <img src={photo.thumb} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span aria-hidden="true">{idea.place}</span>}
      </span>
      <span className="inspiration-text">
        <span className="inspiration-title">{idea.title}</span>
        <span className="inspiration-meta">{idea.meta}</span>
      </span>
    </button>
  );
}
