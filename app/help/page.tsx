import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { InfoPage } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Help · PlanAway", description: "How to plan, refine, share, and export trips with PlanAway." };

const SECTIONS: { id: string; title: string; questions: [question: string, answer: ReactNode][] }[] = [
  {
    id: "planning",
    title: "Planning a trip",
    questions: [
      [
        "How do I start a trip?",
        <>
          Click <b>New trip</b>. Under <b>I have an idea</b>, describe the trip in your own words: where, when, who&rsquo;s going, and your budget.{" "}
          <b>Plan it for me</b> is a form for the details instead, and PlanAway picks the destination if you leave it blank. Or pick one of the{" "}
          <b>Need inspiration?</b> cards to start from it.
        </>,
      ],
      [
        "What does Surprise me! do?",
        <>
          It picks a destination at random and plans the whole trip, starting from your <Link href="/settings">trip defaults</Link>. Each time it
          looks in a different part of the world, and it steers away from places you&rsquo;ve already planned trips to.
        </>,
      ],
      [
        "How long does planning take?",
        <>
          Usually a minute or two. PlanAway searches the web for flights, places to stay, and things to do before it writes the plan, and the plan
          fills in as it goes. You can plan one trip at a time, so start the next one when the first is done.
        </>,
      ],
      [
        "How do I change the plan?",
        <>
          Ask in the chat beside the itinerary, for example &ldquo;swap day 3 for a day trip to Nara&rdquo; or &ldquo;find a cheaper hotel&rdquo;.
          PlanAway revises the plan and tells you what it changed.
        </>,
      ],
      [
        "Where do my defaults in Settings come in?",
        <>
          Your starting point, number of travelers, currency, and pace in <Link href="/settings">Settings</Link> fill in anything a new trip request
          doesn&rsquo;t mention. Whatever you say in the request wins.
        </>,
      ],
    ],
  },
  {
    id: "itinerary",
    title: "Reading the itinerary",
    questions: [
      [
        "Are the prices and times exact?",
        <>
          No. They&rsquo;re estimates based on what PlanAway found on the web when it planned the trip, and prices and opening hours change. Check
          them before you book, and book directly with the airline, hotel, or venue. The <b>Sources</b> section lists the pages PlanAway used.
        </>,
      ],
      [
        "Why is the weather a summary rather than a forecast?",
        <>
          Forecasts more than a week or two out aren&rsquo;t reliable, so PlanAway describes what the weather is usually like at that time of year and
          how to pack for it. Check a forecast closer to the trip.
        </>,
      ],
      [
        "Some places have no pin or photo. Why?",
        <>
          Maps and photos come from OpenStreetMap and Wikimedia Commons. Well-known sights are almost always there, but small restaurants and hotels
          sometimes aren&rsquo;t. For a new trip, pins and photos fill in over a few seconds.
        </>,
      ],
      [
        "Can I go back to an earlier plan?",
        <>
          Yes. <b>Save version</b> keeps the plan as it is now, and the version picker at the top of the itinerary switches between saved versions
          and the current draft.
        </>,
      ],
    ],
  },
  {
    id: "sharing",
    title: "Planning together",
    questions: [
      [
        "How do I share a trip?",
        <>
          In the sidebar, open the trip&rsquo;s menu and choose <b>Share…</b>, then create an invite link and send it. Anyone with a PlanAway account
          who opens the link joins the trip. A link can expire after a day, a week, or a month, or never.
        </>,
      ],
      [
        "What can the people I invite do?",
        <>
          <b>Editors</b> can chat with PlanAway to change the plan, rename the trip, save versions, and comment. <b>Viewers</b> can read the plan
          and comment. Only the trip&rsquo;s owner can invite people, change their roles, or delete the trip.
        </>,
      ],
      [
        "How do comments work?",
        <>
          Hover over a flight, stay, activity, or budget line and click its comment button to leave a note on it. The next time someone chats with
          PlanAway, it reads the new comments, works them into the plan, and replies in each thread, resolving the ones it took care of.
        </>,
      ],
      [
        "How do I leave a trip someone shared with me?",
        <>
          Find it under <b>Shared with you</b> in the sidebar, open its menu, and choose <b>Leave trip…</b>
        </>,
      ],
    ],
  },
  {
    id: "export",
    title: "Exporting",
    questions: [
      [
        "What can I export?",
        <>
          Click <b>Export</b> above the itinerary. You can download a document (.md) to read or print, a calendar file (.ics) with every activity
          for Google Calendar, Apple Calendar, or Outlook, a spreadsheet (.csv) of every flight, stay, and activity with its price, or the raw data
          (.json).
        </>,
      ],
    ],
  },
  {
    id: "account",
    title: "Your account",
    questions: [
      [
        "How do I change my name, email, password, or photo?",
        <>
          In <Link href="/settings">Settings</Link>. Changing your email or password asks for your current password. Settings also has light and
          dark mode, and the colors for each kind of activity.
        </>,
      ],
      [
        "Can PlanAway plan in another language?",
        <>
          Yes. Write your request in any language and PlanAway answers in it, or choose a <b>Plan language</b> in{" "}
          <Link href="/settings">Settings</Link> to have new trips written in that language. The app&rsquo;s own buttons and labels are in English
          for now.
        </>,
      ],
      [
        "I forgot my password.",
        <>
          There&rsquo;s no self-service reset yet. <Link href="/contact">Contact us</Link> from the email address on your account and we&rsquo;ll
          help you get back in.
        </>,
      ],
      [
        "How do I delete my account?",
        <>
          At the bottom of <Link href="/settings">Settings</Link>, choose <b>Delete account…</b> and enter your password. This deletes every trip
          you own, including for the people you shared them with, and it can&rsquo;t be undone. To delete a single trip instead, use its menu in
          the sidebar.
        </>,
      ],
    ],
  },
];

export default function Help() {
  return (
    <InfoPage
      title="Help"
      intro={
        <>
          How to plan, refine, and share trips with PlanAway. Can&rsquo;t find what you need? <Link href="/contact">Get in touch</Link>.
        </>
      }
    >
      <nav className="info-toc" aria-label="On this page">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.title}
          </a>
        ))}
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`}>
          <h2 id={`${s.id}-heading`}>{s.title}</h2>
          {s.questions.map(([q, a]) => (
            <details key={q} className="faq">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      ))}
    </InfoPage>
  );
}
