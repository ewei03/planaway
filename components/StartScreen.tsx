"use client";

import { useState, type FormEvent } from "react";
import type { GroupSummary } from "./client";

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

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "SGD"];

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

function surprisePrompt(f: BuildForm): string {
  return [
    "Surprise me! Pick a destination at random: somewhere interesting I probably wouldn't think of myself, anywhere in the world. Then build the whole trip.",
    ...constraintLines(f),
  ].join("\n");
}

interface Props {
  /** Groups the user can create trips in. */
  groups: GroupSummary[];
  groupId: string;
  onGroupChange: (groupId: string) => void;
  onStart: (prompt: string) => Promise<void>;
  onOpenSidebar: () => void;
}

export function StartScreen({ groups, groupId, onGroupChange, onStart, onOpenSidebar }: Props) {
  const [tab, setTab] = useState<"idea" | "build">("idea");
  const [idea, setIdea] = useState("");
  const [form, setForm] = useState<BuildForm>(EMPTY_FORM);
  const [starting, setStarting] = useState(false);

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
          ☰ Your trips
        </button>
        <h1>Where to next?</h1>
        <p className="muted">
          Describe a trip you have in mind, or tell PlanAway what you like and let it plan one for you. It researches
          flights, stays, and things to do on the web, then builds an itinerary you can refine, save, and export.
        </p>

        {groups.length > 1 && (
          <div className="plan-in">
            <label htmlFor="plan-in">Plan in</label>
            <select id="plan-in" value={groupId} onChange={(e) => onGroupChange(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.personal ? "Personal (just you)" : `${g.name} (${g.memberCount} member${g.memberCount === 1 ? "" : "s"})`}
                </option>
              ))}
            </select>
          </div>
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
              rows={5}
              required
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. 10 days in Japan next April for two, Tokyo and Kyoto, love food and design, about $6,000 total from San Francisco"
            />
            <div className="form-actions">
              <button className="btn primary" type="submit" disabled={starting}>
                Plan this trip
              </button>
            </div>
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
                  <select aria-label="Currency" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
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
              <button className="btn ghost" type="button" disabled={starting} onClick={() => start(surprisePrompt(form))}>
                🎲 Surprise me
              </button>
              <button className="btn primary" type="submit" disabled={starting}>
                Build my trip
              </button>
            </div>
            <p className="hint muted">Surprise me picks a destination at random, using only the origin, budget, and dates you filled in.</p>
          </form>
        )}
      </div>
    </section>
  );
}
