// Browser-side helpers: API calls, SSE parsing, formatting.

import type { AgentEvent } from "@/lib/agent";
import type { ExportFormat } from "@/lib/export";
import type { CommentTarget, CommentView, GroupDetail, GroupSummary, Role, SavedVersion, TripView } from "@/lib/store";

export type { AgentEvent, CommentTarget, CommentView, ExportFormat, GroupDetail, GroupSummary, Role, SavedVersion, TripView };
export type { Itinerary } from "@/lib/itinerary";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Something on the itinerary a comment can be attached to. */
export interface CommentAnchor {
  type: CommentTarget;
  /** The item's id; null for the whole trip. */
  id: string | null;
  label: string;
}

export const anchorKey = (type: CommentTarget, id: string | null) => `${type}:${id ?? ""}`;

export const canEdit = (role: Role) => role === "owner" || role === "editor";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error(await errorText(res));
  return (res.status === 204 ? null : await res.json()) as T;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error || `Request failed (${res.status})`;
}

/** POSTs a message and calls onEvent for each Server-Sent Event until the turn ends. */
export async function streamMessage(tripId: string, text: string, onEvent: (e: AgentEvent) => void): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(await errorText(res));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data) as AgentEvent);
    }
  }
}

export async function downloadExport(tripId: string, format: ExportFormat, versionId: string | null): Promise<void> {
  const params = new URLSearchParams({ format });
  if (versionId) params.set("version", versionId);
  const res = await fetch(`/api/trips/${tripId}/export?${params}`);
  if (!res.ok) throw new Error(await errorText(res));
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `itinerary.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function money(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return formatDate(iso);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
