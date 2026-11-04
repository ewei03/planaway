import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, InfoPage, operatorName } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Privacy · PlanAway", description: "What PlanAway stores, who it's shared with, and your choices." };

// The contact address comes from CONTACT_EMAIL when the page is served.
export const dynamic = "force-dynamic";

export default function Privacy() {
  return (
    <InfoPage
      title="Privacy"
      updated="November 3, 2026"
      intro="What PlanAway stores, who sees it, and what you can do about it, in plain language. We don't sell your data, show ads, or use analytics or tracking."
    >
      <section>
        <h2>Who we are</h2>
        <p>
          PlanAway is operated by {operatorName()}, in Ontario, Canada, who is responsible for the personal information PlanAway handles and
          answers questions about it. You can reach us at <ContactLink /> or through the <Link href="/contact">Contact</Link> page. We handle
          personal information as Canada&rsquo;s privacy law (PIPEDA) requires.
        </p>
      </section>
      <section>
        <h2>What we store</h2>
        <ul>
          <li>
            <b>Your account:</b> your name, email address, date of birth, and password. We ask your date of birth only to confirm you&rsquo;re
            old enough to use PlanAway, and it isn&rsquo;t shown to anyone else. The password is stored only as a secure hash, so no one, including
            us, can read it.
          </li>
          <li>
            <b>Your profile and settings:</b> your profile photo if you add one, your theme and activity colors, and the trip defaults you set
            (starting point, travelers, currency, pace, plan language).
          </li>
          <li>
            <b>Your trips:</b> what you ask PlanAway, its replies, the itineraries and saved versions, comments, and the invite links you create.
          </li>
          <li>
            <b>Email confirmation:</b> whether and when you confirmed your email address, and the short-lived links we email you to confirm it or
            to reset your password.
          </li>
          <li>
            <b>Messages you send us</b> through the Contact page: your name, email address, and message.
          </li>
        </ul>
      </section>
      <section>
        <h2>Why we use it</h2>
        <ul>
          <li>To run your account, sign you in, and keep it secure.</li>
          <li>To plan and revise your trips, and share them with the people you choose.</li>
          <li>To show maps, places, photos, and the way between stops.</li>
          <li>
            To send you emails about your account: confirming your address, resetting your password, and security notices such as a change of
            email address. We don&rsquo;t send marketing emails or newsletters.
          </li>
          <li>To answer messages you send us.</li>
          <li>To prevent abuse, such as limiting how often emails can be sent.</li>
        </ul>
        <p>
          We use your information only for these purposes. By creating an account, you consent to them; you can withdraw your consent by deleting
          your account, although PlanAway can&rsquo;t work without it.
        </p>
      </section>

      <section>
        <h2>Who sees it</h2>
        <ul>
          <li>
            <b>People you plan with.</b> Everyone on a trip sees its plan, chat, and comments, along with the names and photos of the people who
            wrote them. People you share any trip with can see your name and photo.
          </li>
          <li>
            <b>Anthropic</b>, which makes Claude, the AI that plans your trips. To plan or revise a trip, we send it the conversation, new comments
            with their authors&rsquo; names, the current plan, and your trip defaults. It searches the web for flights, stays, and things to do on
            our behalf. We don&rsquo;t send your email address or password. See{" "}
            <a href="https://www.anthropic.com/legal/privacy" rel="noreferrer">
              Anthropic&rsquo;s privacy policy
            </a>
            .
          </li>
          <li>
            <b>Map and place services.</b> To show maps, pins, and photos, our server looks up the names of places in your trips with OpenStreetMap
            (Nominatim), Photon, and Wikimedia, and asks the OpenStreetMap routing servers (FOSSGIS) for the way between them. These requests
            contain place names and map coordinates only, not who you are. Your browser loads map images from
            OpenFreeMap and photos from Wikimedia Commons, so those services see your IP address, as any website you visit would.
          </li>
          <li>
            <b>Our service providers</b>: the company that hosts PlanAway&rsquo;s servers and database, and the email provider that delivers account
            emails and Contact page messages. They handle your information only to provide their service to us.
          </li>
        </ul>
        <p>We don&rsquo;t share your information with anyone else unless the law requires it.</p>
      </section>
      <section>
        <h2>Where it&rsquo;s processed</h2>
        <p>
          Some of the services above store or process information outside Canada: Anthropic, for example, is in the United States, and the
          OpenStreetMap services are in Europe. While it&rsquo;s there, your information is subject to the laws of that country, and its courts and
          authorities may be able to access it.
        </p>
      </section>

      <section>
        <h2>Cookies and browser storage</h2>
        <p>
          We use one cookie, to keep you signed in. Your browser also remembers a few layout choices for PlanAway on that device, such as whether
          the sidebar and chat are open, how trips are sorted, and which itinerary sections you&rsquo;ve collapsed. None of it is used to track
          you.
        </p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          We keep your account and trips until you delete them. Deleting a trip you own removes it, including its chat, comments, and versions, for
          everyone on it. Leaving a trip someone shared with you removes you from it; your comments stay with the trip. Deleting your account
          removes your profile, photo, settings, and every trip you own. Your messages and comments on other people&rsquo;s trips stay, without
          your name or photo. Place lookups (names, locations, and photos, not who asked) are cached for up to 30 days. Email confirmation links
          expire after 24 hours and password reset links after one hour. Messages you send us are kept as long as we need them to help you.
        </p>
      </section>
      <section>
        <h2>Keeping it safe</h2>
        <p>
          PlanAway is served over an encrypted connection, passwords are stored only as secure hashes, and links we email you are stored in a form
          that can&rsquo;t be used if copied. If a security breach creates a real risk of significant harm to you, we&rsquo;ll tell you and report it
          to the Office of the Privacy Commissioner of Canada, as the law requires.
        </p>
      </section>

      <section>
        <h2>Your rights and choices</h2>
        <ul>
          <li>Change your name, email, photo, and defaults at any time in Settings.</li>
          <li>
            Download a copy of your data at any time: <b>Download my data</b> in Settings.
          </li>
          <li>Delete trips you own, or leave trips shared with you, from the sidebar.</li>
          <li>Delete your account at any time from Settings.</li>
          <li>
            Ask to see the personal information we hold about you, or to correct it, by contacting us at <ContactLink />. We&rsquo;ll answer within
            30 days.
          </li>
          <li>
            If you&rsquo;re not satisfied with how we handle your information, contact us first so we can try to fix it. You can also complain to
            the{" "}
            <a href="https://www.priv.gc.ca" rel="noreferrer">
              Office of the Privacy Commissioner of Canada
            </a>
            .
          </li>
        </ul>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          PlanAway isn&rsquo;t meant for children under 13. We ask for a date of birth at sign-up and don&rsquo;t create an account for anyone
          younger, and we don&rsquo;t knowingly collect their information. If you believe a child under 13 has an account, contact us at{" "}
          <ContactLink /> and we&rsquo;ll delete it.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          If we change how we handle your information, we&rsquo;ll update this page and its date. For significant changes, we&rsquo;ll let you know
          in the app.
        </p>
        <p>
          Questions? Contact us at <ContactLink />.
        </p>
      </section>
    </InfoPage>
  );
}
