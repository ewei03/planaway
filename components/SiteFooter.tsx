import Link from "next/link";

// The pages behind these links don't exist yet; they'll 404 until they're built.
export const FOOTER_LINKS: [href: string, label: string][] = [
  ["/about", "About"],
  ["/help", "Help"],
  ["/contact", "Contact"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
];

/** Site links and copyright. `compact` is the small version in the sidebar. */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={`site-footer ${compact ? "compact" : ""}`}>
      <nav aria-label="Site">
        {FOOTER_LINKS.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </nav>
      <p>
        © {new Date().getFullYear()} PlanAway{compact ? "" : " · Trip planning powered by Claude"}
      </p>
    </footer>
  );
}
