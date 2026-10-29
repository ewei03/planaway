import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleItinerary } from "../fixtures";

// The SDK client is replaced by a scripted fake; the real error classes are
// kept so runTurn's instanceof checks behave as in production.
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const Real = actual.default;
  class FakeAnthropic {
    beta = { messages: { stream: streamMock } };
    static AnthropicError = Real.AnthropicError;
    static APIError = Real.APIError;
    static AuthenticationError = Real.AuthenticationError;
    static RateLimitError = Real.RateLimitError;
  }
  return { ...actual, default: FakeAnthropic };
});

import RealAnthropic from "@anthropic-ai/sdk";
import { composeUserMessage, runTurn, type AgentEvent } from "@/lib/agent";

type Block = Anthropic.Beta.BetaContentBlock;

interface Script {
  text?: string[];
  blocks?: Block[];
  stop_reason?: Anthropic.Beta.BetaMessage["stop_reason"];
  /** Rejects finalMessage() with this error instead. */
  error?: unknown;
}

/** A stand-in for BetaMessageStream that replays a scripted response. */
function fakeStream(script: Script) {
  const handlers: Record<string, ((arg: unknown) => void)[]> = {};
  return {
    on(event: string, cb: (arg: unknown) => void) {
      (handlers[event] ??= []).push(cb);
      return this;
    },
    async finalMessage() {
      const fire = (event: string, arg: unknown) => handlers[event]?.forEach((cb) => cb(arg));
      for (const t of script.text ?? []) fire("text", t);
      for (const b of script.blocks ?? []) {
        fire("streamEvent", { type: "content_block_start", content_block: b });
        fire("contentBlock", b);
      }
      if (script.error) throw script.error;
      const content: Block[] = [
        ...(script.text?.length ? [{ type: "text", text: script.text.join(""), citations: null } as Block] : []),
        ...(script.blocks ?? []),
      ];
      return { content, stop_reason: script.stop_reason ?? "end_turn" };
    },
  };
}

const toolUse = (name: string, input: unknown, id = `toolu_${name}`): Block =>
  ({ type: "tool_use", id, name, input }) as Block;

function script(...steps: Script[]) {
  streamMock.mockReset();
  for (const s of steps) streamMock.mockImplementationOnce(() => fakeStream(s));
}

async function run(opts: { openThreads?: string[]; itinerary?: ReturnType<typeof sampleItinerary> | null } = {}) {
  const events: AgentEvent[] = [];
  const result = await runTurn(
    {
      history: [],
      userContent: "[Maya] plan Kyoto",
      itinerary: opts.itinerary ?? null,
      openThreads: new Set(opts.openThreads ?? []),
    },
    (e) => events.push(e),
  );
  return { result, events };
}

const toolResults = (result: { newMessages: Anthropic.Beta.BetaMessageParam[] }): Anthropic.Beta.BetaToolResultBlockParam[] =>
  result.newMessages.flatMap((m) =>
    Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_result") : [],
  ) as Anthropic.Beta.BetaToolResultBlockParam[];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("composeUserMessage", () => {
  it("prefixes the author and adds today's date on the first turn", () => {
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z") });
    const msg = composeUserMessage({ authorName: "Maya", text: "Plan Kyoto", firstTurn: true, newComments: [] });
    vi.useRealTimers();
    expect(msg).toBe("(Today's date is 2026-10-28.)\n\n[Maya] Plan Kyoto");
  });

  it("omits the date on later turns", () => {
    expect(composeUserMessage({ authorName: "Maya", text: "hi", firstTurn: false, newComments: [] })).toBe("[Maya] hi");
  });

  it("lists new comments with their thread ids", () => {
    const msg = composeUserMessage({
      authorName: "Sam",
      text: "update it",
      firstTurn: false,
      newComments: [
        { threadId: "t1", author: "Maya", targetLabel: "Day 1", body: "too busy", isReply: false },
        { threadId: "t1", author: "Lee", targetLabel: "Day 1", body: "agreed", isReply: true },
      ],
    });
    expect(msg).toBe(
      '<new_comments>\n- thread_id=t1 on "Day 1", Maya: too busy\n- thread_id=t1 on "Day 1" (reply), Lee: agreed\n</new_comments>\n\n[Sam] update it',
    );
  });
});

describe("runTurn", () => {
  it("streams a plain text reply", async () => {
    script({ text: ["Hello ", "there"] });
    const { result, events } = await run();
    expect(result?.reply).toBe("Hello there");
    expect(result?.itinerary).toBeNull();
    expect(events).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "there" },
    ]);
    expect(result?.newMessages).toHaveLength(2);
  });

  it("applies a valid update_itinerary call and continues the loop", async () => {
    script(
      { text: ["Building."], blocks: [toolUse("update_itinerary", sampleItinerary())], stop_reason: "tool_use" },
      { text: ["Done!"] },
    );
    const { result, events } = await run();
    expect(result?.itinerary).toEqual(sampleItinerary());
    expect(events).toContainEqual({ type: "status", text: "Writing the itinerary…" });
    expect(events).toContainEqual({ type: "itinerary", itinerary: sampleItinerary() });
    expect(result?.reply).toBe("Building.\n\nDone!");
    const [res] = toolResults(result!);
    expect(res.is_error).toBeUndefined();
    expect(res.content).toContain("2 days");
    // user, assistant(tool_use), user(tool_result), assistant
    expect(result?.newMessages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("sends the history plus new messages on each request", async () => {
    script({ blocks: [toolUse("update_itinerary", sampleItinerary())], stop_reason: "tool_use" }, { text: ["ok"] });
    await run();
    const second = streamMock.mock.calls[1][0] as { messages: unknown[]; tools: { name: string }[] };
    expect(second.messages).toHaveLength(3);
    expect(second.tools.map((t) => t.name)).toEqual(["web_search", "web_fetch", "update_itinerary", "reply_to_comments"]);
  });

  it("returns schema errors to the model and keeps the old itinerary", async () => {
    const old = sampleItinerary();
    script({ blocks: [toolUse("update_itinerary", { title: "broken" })], stop_reason: "tool_use" }, { text: ["Sorry"] });
    const { result, events } = await run({ itinerary: old });
    expect(result?.itinerary).toEqual(old);
    expect(events.some((e) => e.type === "itinerary")).toBe(false);
    const [res] = toolResults(result!);
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/^Invalid itinerary/);
  });

  it("repairs duplicate ids and tells the model", async () => {
    const it = sampleItinerary();
    it.days[0].activities[1].id = "a1";
    script({ blocks: [toolUse("update_itinerary", it)], stop_reason: "tool_use" }, { text: ["ok"] });
    const { result } = await run();
    expect(result?.itinerary?.days[0].activities[1].id).not.toBe("a1");
    expect(toolResults(result!)[0].content).toContain("Fixed missing or duplicate ids: a1 ->");
  });

  it("collects comment replies only for open threads", async () => {
    script(
      {
        blocks: [
          toolUse("reply_to_comments", {
            replies: [
              { thread_id: "open-1", message: "Swapped it", resolve: true },
              { thread_id: "closed-9", message: "?", resolve: false },
            ],
          }),
        ],
        stop_reason: "tool_use",
      },
      { text: ["ok"] },
    );
    const { result } = await run({ openThreads: ["open-1"] });
    expect(result?.commentReplies).toEqual([{ threadId: "open-1", message: "Swapped it", resolve: true }]);
    expect(toolResults(result!)[0].content).toContain("Ignored unknown or already-resolved threads: closed-9");
  });

  it("keeps only the last reply per thread", async () => {
    script(
      {
        blocks: [
          toolUse("reply_to_comments", {
            replies: [
              { thread_id: "t", message: "first", resolve: false },
              { thread_id: "t", message: "second", resolve: true },
            ],
          }),
        ],
        stop_reason: "tool_use",
      },
      { text: ["ok"] },
    );
    const { result } = await run({ openThreads: ["t"] });
    expect(result?.commentReplies).toEqual([{ threadId: "t", message: "second", resolve: true }]);
  });

  it("rejects unknown tools", async () => {
    script({ blocks: [toolUse("book_flight", {})], stop_reason: "tool_use" }, { text: ["ok"] });
    const { result } = await run();
    expect(toolResults(result!)[0]).toMatchObject({ is_error: true, content: "Unknown tool book_flight" });
  });

  it("reports server-side research as status events", async () => {
    script({
      blocks: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "kyoto ryokan" } } as Block,
        { type: "server_tool_use", id: "s2", name: "web_fetch", input: { url: "https://example.com" } } as Block,
      ],
      text: ["Found it"],
    });
    const { events } = await run();
    expect(events).toContainEqual({ type: "status", text: "Searching: kyoto ryokan" });
    expect(events).toContainEqual({ type: "status", text: "Reading: https://example.com" });
  });

  it("resumes after pause_turn", async () => {
    script({ text: ["Part 1. "], stop_reason: "pause_turn" }, { text: ["Part 2."] });
    const { result } = await run();
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(result?.reply).toBe("Part 1. Part 2.");
  });

  it("gives up after too many pause_turn continuations", async () => {
    streamMock.mockReset();
    streamMock.mockImplementation(() => fakeStream({ stop_reason: "pause_turn" }));
    const { result, events } = await run();
    expect(result).toBeNull();
    expect(streamMock).toHaveBeenCalledTimes(9);
    expect(events.at(-1)).toEqual({ type: "error", message: "The agent ran too long on this request." });
  });

  it("fails cleanly on a refusal", async () => {
    script({ stop_reason: "refusal" });
    const { result, events } = await run();
    expect(result).toBeNull();
    expect(events.at(-1)).toEqual({ type: "error", message: "The model declined this request. Try rephrasing it." });
  });

  it("fails when a tool call is cut off by max_tokens", async () => {
    script({ blocks: [toolUse("update_itinerary", {})], stop_reason: "max_tokens" });
    const { result, events } = await run();
    expect(result).toBeNull();
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("too long") });
  });

  it("retries malformed tool JSON up to twice", async () => {
    const bad = () => new RealAnthropic.AnthropicError("Unable to parse tool parameter JSON from model.");
    script({ error: bad() }, { error: bad() }, { text: ["Recovered"] });
    const { result, events } = await run();
    expect(result?.reply).toBe("Recovered");
    expect(events.filter((e) => e.type === "status" && e.text === "Retrying a malformed tool call…")).toHaveLength(2);
  });

  it("stops retrying malformed tool JSON after the limit", async () => {
    const bad = () => new RealAnthropic.AnthropicError("Unable to parse tool parameter JSON from model.");
    script({ error: bad() }, { error: bad() }, { error: bad() });
    const { result, events } = await run();
    expect(result).toBeNull();
    expect(events.at(-1)?.type).toBe("error");
  });

  it.each([
    [new RealAnthropic.AuthenticationError(401, undefined, "bad key", new Headers()), /ANTHROPIC_API_KEY/],
    [new RealAnthropic.RateLimitError(429, undefined, "slow down", new Headers()), /Rate limited/],
    [new RealAnthropic.APIError(500, undefined, "boom", new Headers()), /Anthropic API error 500/],
    [new Error("Could not resolve authentication method."), /No Anthropic credentials/],
    [new Error("kaboom"), /Something went wrong/],
  ])("turns %s into a friendly error", async (error, message) => {
    script({ error });
    const { result, events } = await run();
    expect(result).toBeNull();
    expect(events.at(-1)).toEqual({ type: "error", message: expect.stringMatching(message) });
  });
});
