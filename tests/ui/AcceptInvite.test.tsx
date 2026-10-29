import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptInvite } from "@/components/AcceptInvite";
import type { InvitePreview } from "@/components/client";
import { mockFetch } from "./fixtures";

const preview = (overrides: Partial<InvitePreview> = {}): InvitePreview => ({
  tripId: "trip-1",
  title: "Kyoto Food Weekend",
  summary: "Two days of markets and izakaya.",
  destinations: ["Kyoto", "Nara"],
  startDate: "2026-11-14",
  endDate: "2026-11-15",
  days: 2,
  role: "viewer",
  invitedBy: "Maya",
  expiresAt: null,
  ...overrides,
});

const show = (p: InvitePreview, { signedIn = true, hasAccess = false } = {}) =>
  render(<AcceptInvite token="tok" preview={p} signedIn={signedIn} hasAccess={hasAccess} />);

afterEach(() => vi.unstubAllGlobals());

describe("AcceptInvite", () => {
  it("shows the trip's details and what the invite allows", () => {
    show(preview());
    expect(screen.getByText("Maya invited you to a trip")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kyoto Food Weekend" })).toBeInTheDocument();
    expect(screen.getByText(/^Kyoto, Nara · Nov 14, 2026 – Nov 15, 2026$/)).toBeInTheDocument();
    expect(screen.getByText("Two days of markets and izakaya.")).toBeInTheDocument();
    expect(screen.getByText(/As a viewer, you can see the itinerary and comment on it/)).toBeInTheDocument();
    expect(screen.getByText("You'll only get access to this trip.")).toBeInTheDocument();
  });

  it("describes editor access and falls back to a day count without dates", () => {
    show(preview({ role: "editor", startDate: null, endDate: null, destinations: [] }));
    expect(screen.getByText(/As an editor, you can change the itinerary/)).toBeInTheDocument();
    expect(screen.getByText("2 days")).toBeInTheDocument();
  });

  it("asks signed-out visitors to sign in, and brings them back", () => {
    show(preview(), { signedIn: false });
    expect(screen.getByRole("link", { name: "Sign in to join" })).toHaveAttribute("href", "/login?callbackUrl=%2Finvite%2Ftok");
    expect(screen.queryByRole("button", { name: "Join trip" })).toBeNull();
  });

  it("joins explicitly, then opens the trip", async () => {
    const fetch = mockFetch(() => ({ tripId: "trip-1" }));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    show(preview());
    await userEvent.click(screen.getByRole("button", { name: "Join trip" }));
    expect(fetch).toHaveBeenCalledWith("/api/invites/tok", expect.objectContaining({ method: "POST" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/?trip=trip-1"));
  });

  it("shows an error if joining fails", async () => {
    mockFetch(() => Response.json({ error: "This invite link is invalid or has expired." }, { status: 404 }));
    show(preview());
    await userEvent.click(screen.getByRole("button", { name: "Join trip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This invite link is invalid or has expired.");
    expect(screen.getByRole("button", { name: "Join trip" })).toBeEnabled();
  });

  it("links straight to the trip for people who already have access", () => {
    show(preview(), { hasAccess: true });
    expect(screen.getByRole("link", { name: "Open trip" })).toHaveAttribute("href", "/?trip=trip-1");
  });
});
