import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/InfoPage";

export const metadata: Metadata = {
  title: "About · PlanAway",
  description: "PlanAway plans trips with you: it researches flights, stays, and things to do, builds a day-by-day itinerary, and lets your group shape it together.",
};

const STEPS: [title: string, text: string][] = [
  [
    "Tell it about the trip",
    "Describe it in your own words, fill in a few details, or let PlanAway surprise you. It fills in the rest from your saved defaults.",
  ],
  [
    "It does the research",
    "PlanAway searches the web for flights, places to stay, and things to do, then builds a day-by-day itinerary with times, prices, a map, and a budget.",
  ],
  [
    "Shape it together",
    "Invite the people you're traveling with. Ask for changes in the chat or comment on any part of the plan, and PlanAway works the feedback into the next version.",
  ],
];

const CREDITS: [name: string, href: string, what: string][] = [
  ["Claude", "https://www.anthropic.com/claude", "by Anthropic, the AI that researches and writes each plan"],
  ["OpenStreetMap", "https://www.openstreetmap.org/copyright", "map data and place search, by its contributors"],
  ["OpenFreeMap", "https://openfreemap.org", "map tiles"],
  ["Photon", "https://photon.komoot.io", "place suggestions as you type"],
  ["Wikimedia Commons", "https://commons.wikimedia.org", "photos, each credited to its author"],
  ["OurAirports", "https://ourairports.com", "airport data"],
];

export default function About() {
  return (
    <InfoPage
      title="About PlanAway"
      intro="Planning a trip means hours of tabs: flights, hotels, opening times, and a group chat full of opinions. PlanAway does the legwork and gives everyone one plan to shape together."
    >
      <section aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="about-steps">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="card">
              <span className="about-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="principles-heading">
        <h2 id="principles-heading">What we care about</h2>
        <ul>
          <li>
            <b>Real plans, not vague lists.</b> Every day has concrete times, places, and estimated costs, with the sources PlanAway used so you can
            check them.
          </li>
          <li>
            <b>Planning is a group activity.</b> Everyone on the trip sees the same plan, and anyone can weigh in on the part they care about.
          </li>
          <li>
            <b>Honest about its limits.</b> Prices and schedules change, so PlanAway shows estimates and points you to the source. You book directly
            with the airline, hotel, or venue.
          </li>
          <li>
            <b>Your data stays yours.</b> No ads, no tracking, and nothing sold. Our <Link href="/privacy">Privacy</Link> page explains exactly what
            we store.
          </li>
        </ul>
      </section>

      <section aria-labelledby="credits-heading">
        <h2 id="credits-heading">Built with</h2>
        <ul>
          {CREDITS.map(([name, href, what]) => (
            <li key={name}>
              <a href={href} rel="noreferrer">
                {name}
              </a>
              : {what}
            </li>
          ))}
        </ul>
      </section>

      <div className="about-cta card">
        <div>
          <h2>Where to next?</h2>
          <p className="muted">Start with an idea, or let PlanAway surprise you.</p>
        </div>
        <Link className="btn primary big" href="/">
          Plan a trip
        </Link>
      </div>
    </InfoPage>
  );
}
