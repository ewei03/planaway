import { vi } from "vitest";
import type { CommentView, SessionUser, TripView } from "@/components/client";
import { sampleItinerary } from "../fixtures";

export const me: SessionUser = { id: "u-me", name: "Maya", email: "maya@example.com" };
export const sam = { id: "u-sam", name: "Sam" };

export function tripView(overrides: Partial<TripView> = {}): TripView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    groupId: "g1",
    groupName: "Crew",
    title: "Kyoto Food Weekend",
    role: "owner",
    canDelete: true,
    canShare: true,
    sharedBy: null,
    revision: 1,
    itinerary: sampleItinerary(),
    chat: [],
    versions: [],
    comments: [],
    busy: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

let n = 0;
export function commentView(overrides: Partial<CommentView> = {}): CommentView {
  return {
    id: `c${++n}`,
    parentId: null,
    author: sam,
    targetType: "activity",
    targetId: "a1",
    targetLabel: "Day 1 · Nishiki Market",
    body: "Too pricey?",
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A fetch stub that answers JSON (or 204) and records calls. */
export function mockFetch(respond: (url: string, init?: RequestInit) => unknown = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const result = respond(String(input), init);
    if (result instanceof Response) return result;
    return result === null ? new Response(null, { status: 204 }) : Response.json(result);
  });
}
