import { describe, expect, it, vi } from "vitest";
import { anchorKey, api, canEdit, downloadExport, money, safeUrl, streamMessage, timeAgo, type AgentEvent } from "@/components/client";
import { mockFetch } from "./fixtures";

describe("safeUrl", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://example.com", "http://example.com/"],
    ["javascript:alert(1)", null],
    ["JaVaScRiPt:alert(1)", null],
    ["data:text/html,<script>", null],
    ["/relative", null],
    ["", null],
    [null, null],
  ])("%j -> %j", (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });
});

describe("money", () => {
  it("formats whole currency amounts", () => {
    expect(money(4200, "USD")).toMatch(/4,200/);
  });

  it("returns empty for missing amounts", () => {
    expect(money(null, "USD")).toBe("");
    expect(money(undefined, "USD")).toBe("");
  });

  it("falls back for invalid currency codes", () => {
    expect(money(10, "BAD!")).toBe("10 BAD!");
  });
});

describe("timeAgo", () => {
  it("buckets recent times", () => {
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z") });
    expect(timeAgo("2026-10-28T11:59:30Z")).toBe("just now");
    expect(timeAgo("2026-10-28T11:55:00Z")).toBe("5m ago");
    expect(timeAgo("2026-10-28T09:00:00Z")).toBe("3h ago");
    expect(timeAgo("2026-10-20T12:00:00Z")).toMatch(/Oct/);
    vi.useRealTimers();
  });
});

describe("small helpers", () => {
  it("anchorKey distinguishes types and whole-trip anchors", () => {
    expect(anchorKey("trip", null)).toBe("trip:");
    expect(anchorKey("day", "d1")).not.toBe(anchorKey("activity", "d1"));
  });

  it("canEdit", () => {
    expect([canEdit("owner"), canEdit("editor"), canEdit("viewer")]).toEqual([true, true, false]);
  });
});

describe("api", () => {
  it("sends JSON bodies and parses JSON responses", async () => {
    const fetch = mockFetch(() => ({ id: "x" }));
    expect(await api("/api/trips", { method: "POST", body: "{}" })).toEqual({ id: "x" });
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
  });

  it("returns null for 204", async () => {
    mockFetch(() => null);
    expect(await api("/api/x", { method: "DELETE" })).toBeNull();
  });

  it("throws the server's error message", async () => {
    mockFetch(() => Response.json({ error: "Trip not found" }, { status: 404 }));
    await expect(api("/api/x")).rejects.toThrow("Trip not found");
  });

  it("falls back to the status code for non-JSON errors", async () => {
    mockFetch(() => new Response("<html>oops</html>", { status: 502 }));
    await expect(api("/api/x")).rejects.toThrow("Request failed (502)");
  });
});

describe("streamMessage", () => {
  /** A response whose body arrives in the given chunks. */
  function sse(chunks: string[]) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  it("parses events split across chunk boundaries and ignores keep-alives", async () => {
    const fetch = mockFetch(() =>
      sse([
        'data: {"type":"status","text":"Thin',
        'king"}\n\n: keep-alive\n\ndata: {"type":"text","text":"Hi"}\n',
        '\ndata: {"type":"done","reply":"Hi"}\n\n',
      ]),
    );
    const events: AgentEvent[] = [];
    await streamMessage("t1", "hello", (e) => events.push(e));
    expect(events).toEqual([
      { type: "status", text: "Thinking" },
      { type: "text", text: "Hi" },
      { type: "done", reply: "Hi" },
    ]);
    expect(fetch.mock.calls[0][0]).toBe("/api/trips/t1/messages");
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ text: "hello" });
  });

  it("throws the error for a rejected request", async () => {
    mockFetch(() => Response.json({ error: "Sam is already asking PlanAway" }, { status: 409 }));
    await expect(streamMessage("t1", "hi", () => {})).rejects.toThrow("Sam is already asking PlanAway");
  });
});

describe("downloadExport", () => {
  it("downloads with the server's filename and the version param", async () => {
    const fetch = mockFetch(
      () => new Response("a,b", { headers: { "Content-Disposition": 'attachment; filename="kyoto.csv"' } }),
    );
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("kyoto.csv");
      expect(this.getAttribute("href")).toBe("blob:x");
    });
    await downloadExport("t1", "csv", "v9");
    expect(fetch.mock.calls[0][0]).toBe("/api/trips/t1/export?format=csv&version=v9");
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(document.querySelector("a")).toBeNull();
  });
});
