import { createContext, memo, useContext, useEffect, useId, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { activityQuery, airportQuery, dayColor, heroPhotos, legLabel, lodgingQuery, type Leg, type LegLookup } from "@/lib/route";
import { anchorKey, money, safeUrl, type CommentAnchor, type CommentTarget, type Itinerary } from "./client";
import { CalendarIcon, CategoryIcon, CommentIcon, PlaneIcon, UsersIcon, WalletIcon, WeatherIcon } from "./icons";
import { pickStop, rememberMapShown, useFocusValue, useMapFocus, useRememberedMap } from "./mapFocus";
import { CoverPhotos, PlaceThumb, type FindPlace, type Place, type PlaceLookup } from "./places";
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
  stuck = false,
  shown,
  onToggle,
  children,
}: {
  id: string;
  icon: string;
  title: string;
  count?: number;
  tone?: "tips";
  /** Kept in view at the top while the itinerary scrolls (the map). */
  stuck?: boolean;
  /** Opened and closed from outside rather than remembered here, e.g. the map. */
  shown?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const [remembered, toggle] = useRememberedOpen(id);
  const open = shown ?? remembered;
  const bodyId = useId();

  return (
    <section className={`info-box ${tone ? `info-box-${tone}` : ""} ${open ? "open" : ""} ${stuck ? "stuck" : ""}`}>
      <h3 className="info-box-head">
        <button
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle ?? toggle}
        >
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

/** Clicks on a card or row show it on the map, except clicks on its own links and buttons. */
const onControl = (e: MouseEvent) => !!(e.target as HTMLElement).closest("a, button");

/**
 * A card or row that shows its place on the map when clicked, or when focused
 * and Enter or Space is pressed. It holds its own links and buttons, so it
 * can't be a button itself.
 */
function clickable(activate: () => void, label: string, pressed?: boolean) {
  return {
    tabIndex: 0,
    title: label,
    "aria-current": pressed ? ("true" as const) : undefined,
    onClick: (e: MouseEvent) => !onControl(e) && activate(),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      activate();
    },
  };
}

/** A stay or flight that's on the map, and what to call it. */
interface RowStop {
  id: string;
  label: string;
}

function Row({
  title,
  sub,
  price,
  comment,
  thumb,
  stop,
}: {
  title: ReactNode;
  sub: (string | null | undefined)[];
  price?: ReactNode;
  comment?: ReactNode;
  thumb?: ReactNode;
  stop?: RowStop;
}) {
  const subText = sub.filter(Boolean).join(" · ");
  const focus = useMapFocus();
  const picked = useFocusValue((s) => !!stop && s.spot === stop.id);
  return (
    <div
      className={`row ${stop ? "mapped" : ""} ${picked ? "picked" : ""}`}
      data-stop={stop?.id}
      onMouseEnter={stop ? () => focus.hover(stop.id) : undefined}
      onMouseLeave={stop ? () => focus.hover(null) : undefined}
      {...(stop ? clickable(() => focus.pickSpot(picked ? null : stop.id, { dock: true }), `Show ${stop.label} on the map`, picked) : {})}
    >
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

/** Search OpenStreetMap for a place the map couldn't pin down by itself. */
function osmSearch(query: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}

/** No photos until places are looked up (or when they aren't set up). */
const noPlaces: PlaceLookup = () => undefined;

/** A day as a timeline: time, category icon, then the activity. */
type DayCardProps = {
  day: Day;
  currency: string;
  /** Each activity's place, in order; undefined until it's been looked up. */
  places: (Place | null | undefined)[];
  /** From each mapped activity to the next mapped one; undefined where there's none or it isn't routed yet. */
  legs: (Leg | null | undefined)[];
  onFind?: FindPlace;
} & CommentProps;

/**
 * One day of the timeline. Places arrive a few at a time while the itinerary
 * is open, so a day redraws only when one of its own places, or something else
 * it shows, has changed; redrawing every day for each batch was the slow part.
 */
const DayCard = memo(function DayCard({ day, currency, places, legs, onFind, ...c }: DayCardProps) {
  const focus = useMapFocus();
  // Only this day's picked stops, as a string, so picking on another day doesn't redraw this one.
  const picked = useFocusValue((s) => (s.range?.day === day.day ? `${s.range.from}-${s.range.to}` : ""));
  const [from, to] = picked ? picked.split("-").map(Number) : [0, -1];
  // Stop numbers match the map's: mapped activities only, counted in order.
  let n = 0;
  const orders = places.map((p) => (p ? ++n : null));
  const style = { "--day": dayColor(day.day) } as CSSProperties;
  // From the timeline, the map docks so the picked stops stay in sight.
  const pick = (a: number, b: number) =>
    focus.pick(a === b ? pickStop(focus.get().range, day.day, a) : { day: day.day, from: a, to: b }, { dock: true });
  // Activities the map couldn't place are looked for on a click; these are being looked for, or weren't found nearby.
  const [finding, setFinding] = useState<Record<string, "finding" | "missing">>({});
  const find = async (a: Day["activities"][number], key: string) => {
    if (!onFind || finding[key]) return;
    setFinding((f) => ({ ...f, [key]: "finding" }));
    const found = await onFind(day.day, a);
    setFinding(({ [key]: _, ...rest }) => (found ? rest : { ...rest, [key]: "missing" }));
  };

  return (
    <div className="day">
      <div className="day-head">
        <h4 className="day-heading">
          <span className="day-num">Day {day.day}:</span> {day.title}
        </h4>
        <span className="day-meta">{[day.location, formatDay(day.date)].filter(Boolean).join(" · ")}</span>
      </div>
      <ol className="timeline">
        {day.activities.map((a, i) => {
          const order = orders[i];
          const isPicked = order !== null && order >= from && order <= to;
          const leg = order !== null ? legs[i] : undefined;
          const next = order !== null ? day.activities.find((_, j) => j > i && orders[j] !== null) : undefined;
          const query = activityQuery(a, day);
          const key = a.id || String(i);
          const findable = places[i] === null && !!query && !!onFind;
          const status = finding[key];
          // On the map: show it. Not yet: look for it near the rest of the day. Not found nearby: OpenStreetMap's own search.
          const card =
            order !== null
              ? clickable(() => pick(order, order), `Show ${a.name} on the map`, isPicked)
              : findable && status === "missing"
                ? clickable(() => window.open(osmSearch(query!), "_blank", "noopener,noreferrer"), `${a.name} wasn't found nearby. Search OpenStreetMap`)
                : findable
                  ? clickable(() => find(a, key), `Find ${a.name} on the map`)
                  : {};
          return (
            <li
              className={`act ${order !== null ? "mapped" : ""} ${findable ? "findable" : ""} ${status === "finding" ? "finding" : ""} ${isPicked ? "picked" : ""}`}
              key={key}
              style={order !== null || findable ? style : undefined}
              data-stop={order !== null ? a.id : undefined}
              onMouseEnter={order !== null ? () => focus.hover(a.id) : undefined}
              onMouseLeave={order !== null ? () => focus.hover(null) : undefined}
            >
              <div className="act-time">{a.time ?? ""}</div>
              <span className={`act-icon cat-${a.category}`} role="img" aria-label={a.category} title={a.category}>
                <CategoryIcon category={a.category} size={17} />
              </span>
              <div className="act-card" aria-busy={status === "finding" || undefined} {...card}>
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
                  {order !== null && (
                    <button
                      className="stop-badge"
                      aria-pressed={isPicked}
                      aria-label={`Stop ${order}: show ${a.name} on the map`}
                      title="Show on the map. Pick another stop to see the way between them."
                      onClick={() => pick(order, order)}
                    >
                      {order}
                    </button>
                  )}
                  <span className="row-price">{money(a.est_cost, currency)}</span>
                  <CommentButton type="activity" id={a.id} label={`Day ${day.day} · ${a.name}`} {...c} />
                </div>
              </div>
              {leg && leg.meters > 0 && next && (
                <button
                  className={`act-leg ${isPicked && order! + 1 <= to ? "picked" : ""}`}
                  aria-label={`${legLabel(leg)} to ${next.name}: show the way on the map`}
                  onClick={() => pick(order!, order! + 1)}
                >
                  {legLabel(leg)}
                </button>
              )}
            </li>
          );
        })}
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
    a.onFind === b.onFind &&
    a.places.length === b.places.length &&
    a.places.every((p, i) => p === b.places[i]) &&
    a.legs.length === b.legs.length &&
    a.legs.every((l, i) => l === b.legs[i])
  );
}

function lookupActivity(lookup: PlaceLookup, a: Day["activities"][number], day: Day) {
  const q = activityQuery(a, day);
  return q ? lookup(q) : null;
}

/** For each activity, the leg from its place to the next mapped activity's. */
function dayLegs(places: (Place | null | undefined)[], legs: LegLookup): (Leg | null | undefined)[] {
  return places.map((p, i) => {
    const next = p ? places.slice(i + 1).find(Boolean) : null;
    return p && next ? legs(p, next) : undefined;
  });
}

const noLegs: LegLookup = () => undefined;

interface ViewProps extends CommentProps {
  itinerary: Itinerary;
  /** Places for photos; see usePlaces. */
  lookup?: PlaceLookup;
  /** Street routes between stops, for travel times in the timeline; see useLegs. */
  legs?: LegLookup;
  /** Rendered between the trip facts and the details, e.g. the route map. */
  map?: ReactNode;
  /** Looks for an activity the map couldn't place; see useFoundPlaces. */
  onFind?: FindPlace;
  /** Remembers which boxes this trip has collapsed; every box starts open. */
  tripId?: string;
}

export function ItineraryView({ itinerary: it, counts, onComment, lookup = noPlaces, legs = noLegs, map, onFind, tripId }: ViewProps) {
  const focus = useMapFocus();
  const docked = useFocusValue((s) => s.docked);
  useRememberedMap(focus);
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
        <InfoBox
          id="route"
          icon="🗺️"
          title="Route"
          stuck={docked}
          shown={docked}
          onToggle={() => {
            rememberMapShown(!docked);
            focus.setDocked(!docked);
          }}
        >
          <div className="box-pad">{map}</div>
        </InfoBox>
      )}

      {it.flights.length > 0 && (
        <InfoBox id="flights" icon="✈️" title="Flights" count={it.flights.length}>
          <div className="rows">
            {it.flights.map((f, i) => (
              <Row
                key={f.id || i}
                stop={map && f.id && lookup(airportQuery(f.from)) && lookup(airportQuery(f.to)) ? { id: f.id, label: `the flight ${f.from} → ${f.to}` } : undefined}
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
                stop={map && l.id && lookup(lodgingQuery(l)) ? { id: l.id, label: l.name } : undefined}
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
          {it.days.map((d, i) => {
            const places = d.activities.map((a) => lookupActivity(lookup, a, d));
            return <DayCard key={d.id || i} day={d} currency={c} places={places} legs={dayLegs(places, legs)} onFind={map ? onFind : undefined} {...cp} />;
          })}
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
