import type { ReactNode } from "react";
import { anchorKey, money, safeUrl, type CommentAnchor, type CommentTarget, type Itinerary } from "./client";

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

function Row({ title, sub, price, comment }: { title: ReactNode; sub: (string | null | undefined)[]; price?: string; comment?: ReactNode }) {
  const subText = sub.filter(Boolean).join(" · ");
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-title">{title}</div>
        {subText && <div className="row-sub">{subText}</div>}
      </div>
      {price && <div className="row-price">{price}</div>}
      {comment}
    </div>
  );
}

function DayCard({ day, currency, ...c }: { day: Day; currency: string } & CommentProps) {
  return (
    <div className="day">
      <div className="day-head">
        <span className="day-num">Day {day.day}</span>
        <span className="day-title">{day.title}</span>
        <span className="day-meta">{[day.location, day.date].filter(Boolean).join(" · ")}</span>
        <CommentButton type="day" id={day.id} label={`Day ${day.day}: ${day.title}`} {...c} />
      </div>
      {day.activities.map((a, i) => (
        <div className="act" key={a.id || i}>
          <div className="act-time">{a.time ?? ""}</div>
          <div>
            <div className="act-name">
              <Link text={a.name} url={a.url} />
              <span className="tag">{a.category}</span>
            </div>
            <div className="act-desc">{a.description}</div>
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

export function ItineraryView({ itinerary: it, counts, onComment }: { itinerary: Itinerary } & CommentProps) {
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
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Day by day">
        {it.days.map((d, i) => (
          <DayCard key={d.id || i} day={d} currency={c} {...cp} />
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
        <Section title="Tips">
          <ul className="list">
            {it.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Section>
      )}

      {it.sources.length > 0 && (
        <Section title="Sources">
          <ul className="list">
            {it.sources.map((s, i) => (
              <li key={i}>
                <Link text={s.title} url={s.url} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="disclaimer">Prices are estimates found on the web and change often. Confirm before booking.</p>
    </>
  );
}
