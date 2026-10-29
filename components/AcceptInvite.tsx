"use client";

import { useState } from "react";
import { api, type InvitePreview } from "./client";

interface Props {
  token: string;
  preview: InvitePreview;
  signedIn: boolean;
  /** Already in the trip's group, or joined before. */
  hasAccess: boolean;
}

/** Itinerary dates are plain YYYY-MM-DD; read them as local days. */
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function AcceptInvite({ token, preview, signedIn, hasAccess }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tripUrl = `/?trip=${preview.tripId}`;

  const accept = async () => {
    setBusy(true);
    try {
      await api(`/api/invites/${token}`, { method: "POST" });
      window.location.assign(tripUrl);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const dates =
    preview.startDate && preview.endDate
      ? `${day(preview.startDate)} – ${day(preview.endDate)}`
      : preview.days > 0
        ? `${preview.days} ${preview.days === 1 ? "day" : "days"}`
        : null;

  return (
    <>
      <p className="muted small invite-from">
        {preview.invitedBy ? `${preview.invitedBy} invited you to a trip` : "You're invited to a trip"}
      </p>
      <h1>{preview.title}</h1>
      {(preview.destinations.length > 0 || dates) && (
        <p className="invite-facts">
          {[preview.destinations.join(", "), dates].filter(Boolean).join(" · ")}
        </p>
      )}
      {preview.summary && <p className="muted invite-summary">{preview.summary}</p>}
      <p className="invite-access">
        {preview.role === "editor"
          ? "As an editor, you can change the itinerary with PlanAway."
          : "As a viewer, you can see the itinerary and comment on it."}{" "}
        <span className="muted">You'll only get access to this trip.</span>
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {hasAccess ? (
        <a className="btn primary block" href={tripUrl}>
          Open trip
        </a>
      ) : signedIn ? (
        <button className="btn primary block" disabled={busy} onClick={accept}>
          {busy ? "Joining…" : "Join trip"}
        </button>
      ) : (
        <a className="btn primary block" href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}>
          Sign in to join
        </a>
      )}
    </>
  );
}
