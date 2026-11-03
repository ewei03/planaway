import { createContext, memo, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { activityQuery, heroPhotos, lodgingQuery } from "@/lib/route";
import { anchorKey, money, safeUrl, type CommentAnchor, type CommentTarget, type Itinerary } from "./client";
import { CalendarIcon, CategoryIcon, CommentIcon, PlaneIcon, UsersIcon, WalletIcon, WeatherIcon } from "./icons";
import { CoverPhotos, PlaceThumb, type Place, type PlaceLookup } from "./places";
import { TipText } from "./TipText";

type Day = Itinerary["days"][number];

interface CommentProps {
  /** Open comment threads per anchorKey. */
  counts: Map<string, number>;
  onComment: (anchor: CommentAnchor) => void;
}

function Link({ text, url }: { text: string; url: string | null }) {
  const href = safeUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  ) : (
    <>{text}</>
  );
}

function CommentButton({ type, id, label, counts, onComment }: { type: CommentTarget; id: string | null; label: string } & CommentProps) {
  const n = counts.get(anchorKey(type, id)) ?? 0;
  return (
    <button
      className={`comment-btn ${n ? "has" : ""}`}
      title={n ? `${n} open comment${n > 1 ? "s" : ""}` : "Comment"}
      aria-label={n ? `${n} comments on ${label}` : `Comment on ${label}`}
      onClick={() => onComment({ type, id, label })}
    >
      <CommentIcon size={15} />
      {n > 0 && <span>{n}</span>}
    </button>
  );
}

/** The trip whose boxes these are: open/closed choices are remembered per trip. */
const BoxScope = createContext<string | null>(null);

/**
 * Open (the default) or closed, remembered per browser for this trip, so a new
 * itinerary always starts fully expanded. Without a trip, nothing is
 * remembered. Read after mount so the first render matches the server's.
 */
function useRememberedOpen(id: string): [boolean, () => void] {
  const scope = useContext(BoxScope);
  const key = scope ? `planaway:box-open:${scope}:${id}` : null;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let saved: string | null = null;
    try {
      if (key) saved = localStorage.getItem(key);
    } catch {}
    setOpen(saved !== "0");
  }, [key]);
  const toggle = () => {
    setOpen(!open);
    try {
      if (key) localStorage.setItem(key, open ? "0" : "1");
    } catch {}
  };
  return [open, toggle];
}

/**
 * A boxed part of the itinerary (route, flights, days, budget, tips, sources).
 * The whole box collapses from its header; each person's choice is remembered
 * in their browser. Tips get a tinted accent so they stand apart from the plan.
 */
function InfoBox({
  id,
  icon,
  title,
  count,
  tone,
  children,
}: {
  id: string;
  icon: string;
  title: string;
  count?: number;
  tone?: "tips";
  children: ReactNode;
}) {
  const [open, toggle] = useRememberedOpen(id);
  const bodyId = useId();

  return (
    <section className={`info-box ${tone ? `info-box-${tone}` : ""} ${open ? "open" : ""}`}>
      <h3 className="info-box-head">
        <button aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          <span className="info-box-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="info-box-title">{title}</span>
          {/* Decoration: the heading's name stays just the title. */}
          {count !== undefined && (
            <span className="info-box-count" aria-hidden="true">
              {count}
            </span>
          )}
          <span className="info-box-chevron" aria-hidden="true" />
        </button>
      </h3>
      {/* Grid rows animate between 0fr and 1fr; inert keeps collapsed links out of tab order. */}
      <div className="info-box-body" id={bodyId} inert={!open}>
        <div className="info-box-inner">{children}</div>
      </div>
    </section>
  );
}

/** One source as a whole clickable row: site badge, title, domain. Unsafe URLs stay plain text. */
function SourceLink({ title, url }: { title: string; url: string }) {
  const href = safeUrl(url);
  const domain = href ? new URL(href).hostname.replace(/^www\./, "") : null;
  const body = (
    <>
      <span className="source-badge" aria-hidden="true">
        {(domain ?? title).slice(0, 1).toUpperCase()}
      </span>
      <span className="source-text">
        <span className="source-title">{title}</span>
        {domain && <span className="source-domain">{domain}</span>}
      </span>
      {href && (
        <span className="source-arrow" aria-hidden="true">
          ↗
        </span>
      )}
    </>
  );
  return href ? (
    <a className="source" href={href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <div className="source">{body}</div>
  );
}

function Row({ title, sub, price, comment, thumb }: { title: ReactNode; sub: (string | null | undefined)[]; price?: ReactNode; comment?: ReactNode; thumb?: ReactNode }) {
  const subText = sub.filter(Boolean).join(" · ");
  return (
    <div className="row">
      {thumb}
      <div className="row-main">
        <div className="row-title">{title}</div>
        {subText && <div className="row-sub">{subText}</div>}
      </div>
      {price && <div className="row-price">{price}</div>}
      {comment}
    </div>
  );
}

/** No photos until places are looked up (or when they aren't set up). */
const noPlaces: PlaceLookup = () => undefined;

/** A day as a timeline: time, category icon, then the activity. */
type DayCardProps = {
  day: Day;
  currency: string;
  /** Each activity's place, in order; undefined until it's been looked up. */
  places: (Place | null | undefined)[];
} & CommentProps;

/**
 * One day of the timeline. Places arrive a few at a time while the itinerary
 * is open, so a day redraws only when one of its own places, or something else
 * it shows, has changed; redrawing every day for each batch was the slow part.
 */
const DayCard = memo(function DayCard({ day, currency, places, ...c }: DayCardProps) {
  return (
    <div className="day">
      <div className="day-head">
        <h4 className="day-heading">
          <span className="day-dot" aria-hidden="true" />
          <span className="day-num">Day {day.day}:</span> {day.title}
        </h4>
        <span className="day-meta">{[day.location, formatDay(day.date)].filter(Boolean).join(" · ")}</span>
      </div>
      <ol className="timeline">
        {day.activities.map((a, i) => (
          <li className="act" key={a.id || i}>
            <div className="act-time">{a.time ?? ""}</div>
            <span className={`act-icon cat-${a.category}`} role="img" aria-label={a.category} title={a.category}>
              <CategoryIcon category={a.category} size={17} />
            </span>
            <div className="act-card">
              <div className="act-body">
                <PlaceThumb place={places[i]} label={a.name} />
                <div>
                  <div className="act-name">
                    <Link text={a.name} url={a.url} />
                  </div>
                  <div className="act-desc">{a.description}</div>
                </div>
              </div>
              <div className="act-side">
                <span className="row-price">{money(a.est_cost, currency)}</span>
                <CommentButton type="activity" id={a.id} label={`Day ${day.day} · ${a.name}`} {...c} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}, sameDay);

/** "2027-04-02" as a local date, so the day doesn't shift with the time zone. */
function parseDate(iso: string | null): Date | null {
  const m = iso && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** "Fri, Apr 2", or the text as given if it isn't a date. */
function formatDay(iso: string | null): string | null {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : iso;
}

/** "Apr 2 – 4", "Apr 30 – May 3", or "Dec 30, 2026 – Jan 2, 2027". */
export function formatRange(start: string | null, end: string | null): string | null {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b) return a ? a.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  const sameYear = a.getFullYear() === b.getFullYear();
  const md = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  if (sameYear && a.getMonth() === b.getMonth()) return `${md(a)} – ${b.getDate()}`;
  return `${md(a)} – ${md(b)}`;
}

/** Colors for budget categories, in order; the bar and the budget rows share them. */
const BUDGET_COLORS = ["#3D5F95", "#8A5A9E", "#E0694A", "#6FB5A3", "#D9A441", "#B85C7A", "#5E8C4A", "#7A7468"];
const budgetColor = (i: number) => BUDGET_COLORS[i % BUDGET_COLORS.length];

function BudgetBar({ lines, currency }: { lines: Itinerary["budget"]["breakdown"]; currency: string }) {
  const parts = lines.map((b, i) => ({ ...b, color: budgetColor(i) })).filter((b) => b.amount > 0);
  if (parts.length === 0) return null;
  const label = parts.map((b) => `${b.category} ${money(b.amount, currency)}`).join(", ");
  return (
    <div className="budget-bar">
      <div className="budget-track" role="img" aria-label={`Budget: ${label}`}>
        {parts.map((b, i) => (
          <span key={b.id || i} style={{ flexGrow: b.amount, background: b.color }} />
        ))}
      </div>
      <div className="budget-legend" aria-hidden="true">
        {parts.map((b, i) => (
          <span key={b.id || i}>
            <span className="swatch" style={{ background: b.color }} />
            {b.category} {money(b.amount, currency)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <span className="stat-text">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
        {sub && <span className="stat-sub">{sub}</span>}
      </span>
    </div>
  );
}

function sameDay(a: DayCardProps, b: DayCardProps): boolean {
  return (
    a.day === b.day &&
    a.currency === b.currency &&
    a.counts === b.counts &&
    a.onComment === b.onComment &&
    a.places.length === b.places.length &&
    a.places.every((p, i) => p === b.places[i])
  );
}

function lookupActivity(lookup: PlaceLookup, a: Day["activities"][number], day: Day) {
  const q = activityQuery(a, day);
  return q ? lookup(q) : null;
}

interface ViewProps extends CommentProps {
  itinerary: Itinerary;
  /** Places for photos; see usePlaces. */
  lookup?: PlaceLookup;
  /** Rendered between the trip facts and the details, e.g. the route map. */
  map?: ReactNode;
  /** Remembers which boxes this trip has collapsed; every box starts open. */
  tripId?: string;
}

export function ItineraryView({ itinerary: it, counts, onComment, lookup = noPlaces, map, tripId }: ViewProps) {
  const c = it.currency;
  const cp = { counts, onComment };
  const days = `${it.days.length} day${it.days.length === 1 ? "" : "s"}`;
  const dates = formatRange(it.start_date, it.end_date);
  const cover = heroPhotos(it, lookup);

  return (
    <BoxScope.Provider value={tripId ?? null}>
      <CoverPhotos photos={cover} />
      <div className={`it-card ${cover.length ? "over-cover" : ""}`}>
        <div className="it-head">
          {it.destinations.length > 0 && <p className="eyebrow">{it.destinations.join(" · ")}</p>}
          <h2>{it.title}</h2>
          <p className="it-summary">{it.summary}</p>
        </div>
        <div className="stats">
          <Stat icon={<CalendarIcon size={20} />} label="Dates" value={dates ?? days} sub={dates ? days : undefined} />
          <Stat icon={<UsersIcon size={20} />} label="Travelers" value={`${it.travelers} ${it.travelers === 1 ? "person" : "people"}`} />
          {it.origin && <Stat icon={<PlaneIcon size={20} />} label="From" value={it.origin} />}
          {it.budget.estimated_total !== null && <Stat icon={<WalletIcon size={20} />} label="Est. total" value={money(it.budget.estimated_total, c)} />}
        </div>
        {/* Itineraries saved before weather existed have no weather field at all. */}
        {it.weather && (
          <div className="weather-note">
            <span className="weather-note-icon">
              <WeatherIcon kind={it.weather.kind} size={22} />
            </span>
            <p>
              <strong>What to expect:</strong> {it.weather.summary} <span className="weather-prepare">{it.weather.prepare}</span>
            </p>
          </div>
        )}
        <BudgetBar lines={it.budget.breakdown} currency={c} />
      </div>

      {map && (
        <InfoBox id="route" icon="🗺️" title="Route">
          <div className="box-pad">{map}</div>
        </InfoBox>
      )}

      {it.flights.length > 0 && (
        <InfoBox id="flights" icon="✈️" title="Flights" count={it.flights.length}>
          <div className="rows">
            {it.flights.map((f, i) => (
              <Row
                key={f.id || i}
                title={<Link text={`${f.from} → ${f.to}`} url={f.booking_url} />}
                sub={[f.date, f.carrier, f.notes]}
                price={money(f.est_price, c)}
                comment={<CommentButton type="flight" id={f.id} label={`Flight ${f.from} → ${f.to}`} {...cp} />}
              />
            ))}
          </div>
        </InfoBox>
      )}

      {it.lodging.length > 0 && (
        <InfoBox id="stays" icon="🏨" title="Where to stay" count={it.lodging.length}>
          <div className="rows">
            {it.lodging.map((l, i) => (
              <Row
                key={l.id || i}
                title={<Link text={l.name} url={l.booking_url} />}
                sub={[l.area, l.check_in || l.check_out ? `${l.check_in ?? "?"} → ${l.check_out ?? "?"}` : null, l.notes]}
                price={
                  l.nightly_price !== null ? (
                    <>
                      {money(l.nightly_price, c)}
                      <span className="price-unit"> / night</span>
                    </>
                  ) : undefined
                }
                comment={<CommentButton type="lodging" id={l.id} label={`Stay: ${l.name}`} {...cp} />}
                thumb={<PlaceThumb place={lookup(lodgingQuery(l))} label={l.name} size={44} />}
              />
            ))}
          </div>
        </InfoBox>
      )}

      <InfoBox id="days" icon="📅" title="Day by day" count={it.days.length}>
        <div className="box-pad">
          {it.days.map((d, i) => (
            <DayCard key={d.id || i} day={d} currency={c} places={d.activities.map((a) => lookupActivity(lookup, a, d))} {...cp} />
          ))}
        </div>
      </InfoBox>

      {(it.budget.breakdown.length > 0 || it.budget.notes) && (
        <InfoBox id="budget" icon="💰" title="Budget">
          <div className="rows">
            {it.budget.breakdown.map((b, i) => (
              <Row
                key={b.id || i}
                title={
                  <>
                    <span className="swatch" style={{ background: budgetColor(i) }} aria-hidden="true" />
                    {b.category}
                  </>
                }
                sub={[b.notes]}
                price={money(b.amount, c)}
                comment={<CommentButton type="budget" id={b.id} label={`Budget: ${b.category}`} {...cp} />}
              />
            ))}
          </div>
          {it.budget.estimated_total !== null && (
            <div className="budget-total">
              <span className="budget-total-label">
                Estimated total
                <span className="budget-total-sub">
                  {it.travelers > 1
                    ? `About ${money(it.budget.estimated_total / it.travelers, c)} per person, for ${it.travelers} travelers`
                    : "For 1 traveler"}
                </span>
              </span>
              <span className="budget-total-amount">{money(it.budget.estimated_total, c)}</span>
            </div>
          )}
          {it.budget.notes && <p className="disclaimer">{it.budget.notes}</p>}
        </InfoBox>
      )}

      {it.tips.length > 0 && (
        <InfoBox id="tips" tone="tips" icon="💡" title="Tips">
          <ol className="tip-list">
            {it.tips.map((t, i) => (
              <li key={i}>
                <span>
                  <TipText text={t} />
                </span>
              </li>
            ))}
          </ol>
        </InfoBox>
      )}

      {it.sources.length > 0 && (
        <InfoBox id="sources" icon="🔗" title="Sources" count={it.sources.length}>
          <ul className="source-list">
            {it.sources.map((s, i) => (
              <li key={i}>
                <SourceLink title={s.title} url={s.url} />
              </li>
            ))}
          </ul>
        </InfoBox>
      )}

      <p className="disclaimer">Prices are estimates found on the web and change often. Confirm before booking.</p>
    </BoxScope.Provider>
  );
}
