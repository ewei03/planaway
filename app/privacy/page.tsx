import type { Metadata } from "next";
import { ContactLink, InfoPage } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Privacy · PlanAway", description: "What PlanAway stores, who it's shared with, and your choices." };

// The contact address comes from CONTACT_EMAIL when the page is served.
export const dynamic = "force-dynamic";

export default function Privacy() {
  return (
    <InfoPage
      title="Privacy"
      updated="November 2, 2026"
      intro="What PlanAway stores, who sees it, and what you can do about it, in plain language. We don't sell your data, show ads, or use analytics or tracking."
    >
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
        </ul>
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
            (Nominatim), Photon, and Wikimedia. These lookups contain place names only, not who you are. Your browser loads map images from
            OpenFreeMap and photos from Wikimedia Commons, so those services see your IP address, as any website you visit would.
          </li>
        </ul>
        <p>We don&rsquo;t share your information with anyone else unless the law requires it.</p>
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
          your name or photo. Place lookups (names, locations, and photos, not who asked) are cached for up to 30 days.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li>Change your name, email, photo, and defaults at any time in Settings.</li>
          <li>Delete trips you own, or leave trips shared with you, from the sidebar.</li>
          <li>Delete your account at any time from Settings.</li>
          <li>
            To get a copy of your data, contact us at <ContactLink /> from the email address on your account.
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
