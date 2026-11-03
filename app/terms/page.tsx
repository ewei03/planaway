import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, InfoPage } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Terms · PlanAway", description: "The terms for using PlanAway." };

// The contact address comes from CONTACT_EMAIL when the page is served.
export const dynamic = "force-dynamic";

export default function Terms() {
  return (
    <InfoPage
      title="Terms of use"
      updated="November 2, 2026"
      intro="The ground rules for using PlanAway. By creating an account or using PlanAway, you agree to them."
    >
      <section>
        <h2>PlanAway plans; you book</h2>
        <p>
          PlanAway is a planning tool. It suggests itineraries using AI and information it finds on the web. It isn&rsquo;t a travel agent: we
          don&rsquo;t sell or book flights, stays, or activities, and we&rsquo;re not part of any booking you make. Bookings are between you and the
          airline, hotel, or other business.
        </p>
      </section>

      <section>
        <h2>Check before you go</h2>
        <p>
          AI-written plans can be wrong or out of date. Prices, schedules, opening hours, and availability change, and PlanAway&rsquo;s figures are
          estimates. Before you book or travel, check the details with the business itself, and check entry requirements, visas, health advice,
          and travel warnings with official sources. You&rsquo;re responsible for the decisions you make using PlanAway.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <p>
          Give accurate details when you sign up, keep your password to yourself, and tell us if you think someone else is using your account.
          You&rsquo;re responsible for what happens under your account.
        </p>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          Your trips, messages, comments, and photo stay yours. You let us store them, process them to run PlanAway (including sending them to the
          services described in our <Link href="/privacy">Privacy</Link> page), and show them to the people you share a trip with. When you invite
          someone to a trip, they can see everything in it, so only share trips with people you trust.
        </p>
      </section>

      <section>
        <h2>Fair use</h2>
        <p>Please don&rsquo;t:</p>
        <ul>
          <li>use PlanAway for anything illegal, or to harass, threaten, or deceive anyone;</li>
          <li>post content you don&rsquo;t have the right to share;</li>
          <li>try to get into other people&rsquo;s accounts or trips, or interfere with how PlanAway runs;</li>
          <li>use automated tools to make heavy use of PlanAway, or to copy its content in bulk.</li>
        </ul>
        <p>We may suspend or close accounts that break these rules.</p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          We&rsquo;re working to keep PlanAway running well, but we provide it as is, without guarantees that it will always be available,
          error-free, or suited to a particular purpose. We may change features or limits, or stop offering PlanAway, and we&rsquo;ll give
          reasonable notice of significant changes where we can.
        </p>
        <p>
          To the extent the law allows, we&rsquo;re not liable for indirect or consequential losses, or for losses from relying on a plan, such as
          missed connections, changed prices, or bookings with other businesses.
        </p>
      </section>

      <section>
        <h2>Ending your account</h2>
        <p>
          You can stop using PlanAway at any time, and ask us to delete your account by contacting us at <ContactLink />.
        </p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p>
          If we change these terms, we&rsquo;ll update this page and its date, and let you know in the app about significant changes. Using PlanAway
          after a change means you accept the new terms.
        </p>
        <p>
          Questions? Contact us at <ContactLink />.
        </p>
      </section>
    </InfoPage>
  );
}
