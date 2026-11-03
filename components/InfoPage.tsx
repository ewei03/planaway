import Link from "next/link";
import type { ReactNode } from "react";
import { LogoIcon } from "./icons";
import { SiteFooter } from "./SiteFooter";

/** The frame for the footer pages (Help, Contact, Privacy, Terms): open to everyone, signed in or not. */
export function InfoPage({ title, intro, updated, children }: { title: string; intro?: ReactNode; updated?: string; children: ReactNode }) {
  return (
    <div className="info-page">
      <header className="info-header">
        <Link className="brand" href="/">
          <span className="logo" aria-hidden="true">
            <LogoIcon />
          </span>
          <span className="brand-name">PlanAway</span>
        </Link>
      </header>
      <main className="info-inner">
        <h1>{title}</h1>
        {intro && <p className="info-intro">{intro}</p>}
        {updated && <p className="muted small">Last updated {updated}</p>}
        <div className="info-body">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** The contact address, from CONTACT_EMAIL; null until it's set. */
export function contactEmail(): string | null {
  return process.env.CONTACT_EMAIL?.trim() || null;
}

/** The contact address as a link, or a pointer to the Contact page when none is set. */
export function ContactLink() {
  const email = contactEmail();
  return email ? <a href={`mailto:${email}`}>{email}</a> : <Link href="/contact">our Contact page</Link>;
}
