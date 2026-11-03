import type { Metadata } from "next";
import Link from "next/link";
import { contactEmail, InfoPage } from "@/components/InfoPage";

export const metadata: Metadata = { title: "Contact · PlanAway", description: "How to reach the PlanAway team." };

// Read CONTACT_EMAIL when the page is served, not when it's built.
export const dynamic = "force-dynamic";

const REASONS: [title: string, subject: string, text: string][] = [
  ["Something isn't working", "Bug report", "Tell us what you did, what you expected, and what happened instead. A screenshot helps."],
  ["Account help", "Account help", "Forgotten password, changing your email, or deleting your account. Write from the address on your account."],
  ["Ideas and feedback", "Feedback", "What would make PlanAway better for your next trip?"],
  ["Privacy questions", "Privacy", "Questions about your data, or a request to see or delete it."],
];

export default function Contact() {
  const email = contactEmail();
  const mailto = (subject: string) => `mailto:${email}?${new URLSearchParams({ subject: `PlanAway: ${subject}` }).toString().replace(/\+/g, "%20")}`;
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
        <p className="contact-email">
          Email us at <a href={`mailto:${email}`}>{email}</a>. We usually reply within a couple of working days.
        </p>
      ) : (
        <p className="contact-email muted">Our contact email address isn&rsquo;t available yet. Please check back soon.</p>
      )}
      <ul className="contact-reasons">
        {REASONS.map(([title, subject, text]) => (
          <li key={title} className="card">
            <h2>{title}</h2>
            <p className="muted">{text}</p>
            {email && (
              <a className="btn soft" href={mailto(subject)}>
                Email us
              </a>
            )}
          </li>
        ))}
      </ul>
    </InfoPage>
  );
}
