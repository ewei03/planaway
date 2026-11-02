import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "@/components/SiteFooter";

describe("SiteFooter", () => {
  it("links to the site pages, with the copyright year", () => {
    render(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "Site" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["About", "/about"],
      ["Help", "/help"],
      ["Contact", "/contact"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ]);
    expect(screen.getByText(`© ${new Date().getFullYear()} PlanAway · Trip planning powered by Claude`)).toBeInTheDocument();
  });

  it("leaves out the tagline when compact", () => {
    render(<SiteFooter compact />);
    expect(screen.getByText(`© ${new Date().getFullYear()} PlanAway`)).toBeInTheDocument();
  });
});
