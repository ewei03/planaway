import { useEffect, useId, useState, type ReactNode } from "react";
import { activityQuery, heroPhotos, lodgingQuery } from "@/lib/route";
import { anchorKey, money, safeUrl, type CommentAnchor, type CommentTarget, type Itinerary } from "./client";
import { HeroPhotos, PlaceThumb, type PlaceLookup } from "./places";
import { TipText } from "./TipText";
import { dayColor } from "./TripMap";

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
      💬{n > 0 && <span>{n}</span>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Tips start open; sources, usually a long list of links, start collapsed. */
const BOX_OPEN_BY_DEFAULT = { tips: true, sources: false };

/**
 * A boxed section that stands apart from the plan itself, for tips and
 * sources. The whole box collapses from its header; each person's choice is
 * remembered in their browser.
 */
function InfoBox({ tone, icon, title, count, children }: { tone: "tips" | "sources"; icon: string; title: string; count?: number; children: ReactNode }) {
  const storageKey = `planaway:box-open:${tone}`;
  const [open, setOpen] = useState(BOX_OPEN_BY_DEFAULT[tone]);
  const bodyId = useId();

  // Read after mount so the first render matches the server's.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) setOpen(saved === "1");
    } catch {}
  }, [storageKey]);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(storageKey, open ? "0" : "1");
    } catch {}
  };

  return (
    <section className={`info-box info-box-${tone} ${open ? "open" : ""}`}>
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

function Row({ title, sub, price, comment, thumb }: { title: ReactNode; sub: (string | null | undefined)[]; price?: string; comment?: ReactNode; thumb?: ReactNode }) {
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

function DayCard({ day, currency, lookup, ...c }: { day: Day; currency: string; lookup: PlaceLookup } & CommentProps) {
  return (
    <div className="day">
      <div className="day-head">
        <span className="day-num">
          <span className="day-dot" style={{ background: dayColor(day.day) }} aria-hidden="true" />
          Day {day.day}
        </span>
        <span className="day-title">{day.title}</span>
        <span className="day-meta">{[day.location, day.date].filter(Boolean).join(" · ")}</span>
        <CommentButton type="day" id={day.id} label={`Day ${day.day}: ${day.title}`} {...c} />
      </div>
      {day.activities.map((a, i) => (
        <div className="act" key={a.id || i}>
          <div className="act-time">{a.time ?? ""}</div>
          <div className="act-body">
            <PlaceThumb place={lookupActivity(lookup, a, day)} label={a.name} />
            <div>
              <div className="act-name">
                <Link text={a.name} url={a.url} />
                <span className="tag">{a.category}</span>
              </div>
              <div className="act-desc">{a.description}</div>
            </div>
          </div>
          <div className="act-side">
            <span className="row-price">{money(a.est_cost, currency)}</span>
            <CommentButton type="activity" id={a.id} label={`Day ${day.day} · ${a.name}`} {...c} />
          </div>
        </div>
      ))}
    </div>
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
}

export function ItineraryView({ itinerary: it, counts, onComment, lookup = noPlaces, map }: ViewProps) {
  const c = it.currency;
  const cp = { counts, onComment };
  const facts = [
    it.origin && ["From", it.origin],
    it.destinations.length > 0 && ["To", it.destinations.join(", ")],
    (it.start_date || it.end_date) && ["Dates", `${it.start_date ?? "?"} → ${it.end_date ?? "?"}`],
    ["Days", String(it.days.length)],
    ["Travelers", String(it.travelers)],
    it.budget.estimated_total !== null && ["Est. total", money(it.budget.estimated_total, c)],
  ].filter((f): f is [string, string] => Array.isArray(f));

  return (
    <>
      <HeroPhotos photos={heroPhotos(it, lookup)} />
      <div className="it-head">
        <div className="it-title-row">
          <h2>{it.title}</h2>
          <CommentButton type="trip" id={null} label="Whole trip" {...cp} />
        </div>
        <p>{it.summary}</p>
      </div>
      <div className="facts">
        {facts.map(([k, v]) => (
          <span className="fact" key={k}>
            <b>{k}:</b> {v}
          </span>
        ))}
      </div>

      {map && <Section title="Route">{map}</Section>}

      {it.flights.length > 0 && (
        <Section title="Flights">
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
        </Section>
      )}

      {it.lodging.length > 0 && (
        <Section title="Where to stay">
          <div className="rows">
            {it.lodging.map((l, i) => (
              <Row
                key={l.id || i}
                title={<Link text={l.name} url={l.booking_url} />}
                sub={[l.area, l.check_in || l.check_out ? `${l.check_in ?? "?"} → ${l.check_out ?? "?"}` : null, l.notes]}
                price={l.nightly_price !== null ? `${money(l.nightly_price, c)}/night` : undefined}
                comment={<CommentButton type="lodging" id={l.id} label={`Stay: ${l.name}`} {...cp} />}
                thumb={<PlaceThumb place={lookup(lodgingQuery(l))} label={l.name} size={44} />}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Day by day">
        {it.days.map((d, i) => (
          <DayCard key={d.id || i} day={d} currency={c} lookup={lookup} {...cp} />
        ))}
      </Section>

      {(it.budget.breakdown.length > 0 || it.budget.notes) && (
        <Section title="Budget">
          <div className="rows">
            {it.budget.breakdown.map((b, i) => (
              <Row
                key={b.id || i}
                title={b.category}
                sub={[b.notes]}
                price={money(b.amount, c)}
                comment={<CommentButton type="budget" id={b.id} label={`Budget: ${b.category}`} {...cp} />}
              />
            ))}
            {it.budget.estimated_total !== null && (
              <div className="row total-row">
                <div className="row-main">Estimated total</div>
                <div className="row-price">{money(it.budget.estimated_total, c)}</div>
              </div>
            )}
          </div>
          {it.budget.notes && <p className="disclaimer">{it.budget.notes}</p>}
        </Section>
      )}

      {it.tips.length > 0 && (
        <InfoBox tone="tips" icon="💡" title="Tips">
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
        <InfoBox tone="sources" icon="🔗" title="Sources" count={it.sources.length}>
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
    </>
  );
}
