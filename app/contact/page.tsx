import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { ContactForm } from "@/components/ContactForm";
import { contactEmail, InfoPage } from "@/components/InfoPage";
import { CONTACT_TOPICS } from "@/lib/site";
import { getProfile } from "@/lib/store";

export const metadata: Metadata = { title: "Contact · PlanAway", description: "How to reach the PlanAway team." };

// Read CONTACT_EMAIL when the page is served, not when it's built.
export const dynamic = "force-dynamic";

export default async function Contact() {
  const email = contactEmail();
  // Signed in: the form starts with your name and address.
  const userId = (await auth())?.user?.id;
  const profile = userId ? await getProfile(userId).catch(() => null) : null;
  return (
    <InfoPage
      title="Contact"
      intro={
        <>
          Questions, problems, or ideas: we&rsquo;d like to hear them. For how-to questions, the <Link href="/help">Help</Link> page may have the
          answer already.
        </>
      }
    >
      {email ? (
        <>
          <ContactForm topics={CONTACT_TOPICS} initial={{ name: profile?.name ?? "", email: profile?.email ?? "" }} />
          <p className="contact-email">
            Prefer email? Write to <a href={`mailto:${email}`}>{email}</a>. We usually reply within a couple of working days.
          </p>
        </>
      ) : (
        <p className="contact-email muted">Our contact details aren&rsquo;t available yet. Please check back soon.</p>
      )}
    </InfoPage>
  );
}
