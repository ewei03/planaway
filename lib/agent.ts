import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Itinerary, itineraryJsonSchema, normalizeIds } from "./itinerary";
import type { NewComment } from "./store";

const MODEL = process.env.PLANAWAY_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.PLANAWAY_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_CONTINUATIONS = 8;

const client = new Anthropic();

const SYSTEM_PROMPT = `You are PlanAway, a travel planning agent. You build and refine concrete, bookable trip itineraries for a group of travelers who plan together.

How you work:
- Research with web_search before committing to specifics: flight routes and typical fares (Google Flights, Kayak, Expedia, Skyscanner), lodging options and nightly rates (Booking.com, Expedia, Airbnb, hotel sites), attractions with opening hours and ticket prices (official sites), and first-hand advice from forums (Reddit travel subreddits, TripAdvisor forums). Use web_fetch to read a promising page in full when a search snippet isn't enough.
- Prices you find are estimates. Say so, prefer recent sources, and convert to the trip's currency.
- Make reasonable assumptions instead of asking questions when the request is open-ended, and state the assumptions in your reply. Ask a question only when the answer would change the plan substantially and you can't sensibly guess.
- Keep each day realistic: group nearby sights, allow for transit and meals, don't overpack.
- Stay within the budget when one is given; flag clearly if it isn't achievable and suggest what to change.

Collaboration:
- Several people share this trip. Each message starts with the sender's name in brackets, e.g. "[Maya] add a beach day". Preferences can differ between people: balance them, and when they truly conflict, propose a compromise and name whose preference you favored and why.
- Collaborators leave comments on parts of the itinerary (an activity, a day, a flight, the budget...). New comments since your last turn are listed in a <new_comments> block in the message. Treat them as requests and feedback from those people.
- Address comments with reply_to_comments: reply briefly in the thread, and set resolve to true when you changed the plan to address it or the point is settled. Leave a thread open when it needs a decision from the group.

The itinerary:
- Whenever you create or change the plan, call update_itinerary with the COMPLETE itinerary (not a diff). Everyone sees it in a side panel and can save and export it.
- Every day, activity, flight, lodging and budget line has an id. Keep an item's id when you keep or edit the item, so comments stay attached to it. Give new items new short ids that aren't used elsewhere (e.g. "a14").
- Put real URLs you found into booking_url / url fields and list your main references in sources. Never invent URLs.
- If dates are unknown, leave dates null and use day numbers.

Your chat replies:
- Keep them short: the panel shows the details. Summarize what you built or changed, list key assumptions, and suggest one or two refinements.
- Plain text with light Markdown (bold, bullet lists, links). No tables or headings.`;

const CommentReplies = z.object({
  replies: z.array(
    z.object({
      thread_id: z.string(),
      message: z.string(),
      resolve: z.boolean(),
    }),
  ),
});

const tools: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 12 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
  {
    name: "update_itinerary",
    description:
      "Replace the trip's itinerary with this complete version. Call after building the first plan and after every change.",
    // Not `strict`: strict mode allows at most 16 nullable/union fields and the
    // itinerary has more. runTurn validates input with Zod and returns errors
    // to Claude as is_error tool results so it can correct itself.
    eager_input_streaming: true,
    input_schema: itineraryJsonSchema as Anthropic.Beta.BetaTool.InputSchema,
  },
  {
    name: "reply_to_comments",
    description:
      "Reply in collaborators' comment threads, and optionally resolve them. Use the thread_id shown in <new_comments>.",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        replies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              thread_id: { type: "string" },
              message: { type: "string", description: "Short reply shown in the thread" },
              resolve: { type: "boolean", description: "True if the comment has been addressed" },
            },
            required: ["thread_id", "message", "resolve"],
            additionalProperties: false,
          },
        },
      },
      required: ["replies"],
      additionalProperties: false,
    },
  },
];

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "itinerary"; itinerary: Itinerary }
  | { type: "done"; reply: string }
  | { type: "error"; message: string };

/** Builds the user message the agent sees: who's speaking, plus any new comments. */
export function composeUserMessage(opts: {
  authorName: string;
  text: string;
  firstTurn: boolean;
  newComments: NewComment[];
}): string {
  const parts: string[] = [];
  // The date goes in the first user message rather than the system prompt so
  // the system prompt stays byte-identical and cacheable.
  if (opts.firstTurn) parts.push(`(Today's date is ${new Date().toISOString().slice(0, 10)}.)`);
  if (opts.newComments.length) {
    const lines = opts.newComments.map(
      (c) => `- thread_id=${c.threadId} on "${c.targetLabel}"${c.isReply ? " (reply)" : ""}, ${c.author}: ${c.body}`,
    );
    parts.push(`<new_comments>\n${lines.join("\n")}\n</new_comments>`);
  }
  parts.push(`[${opts.authorName}] ${opts.text}`);
  return parts.join("\n\n");
}

export interface TurnInput {
  history: Anthropic.Beta.BetaMessageParam[];
  userContent: string;
  itinerary: Itinerary | null;
  /** Unresolved thread ids the agent may reply to. */
  openThreads: Set<string>;
}

export interface TurnResult {
  newMessages: Anthropic.Beta.BetaMessageParam[];
  reply: string;
  itinerary: Itinerary | null;
  commentReplies: { threadId: string; message: string; resolve: boolean }[];
}

class TurnFailed extends Error {}

/**
 * Runs one user turn and streams its progress through `emit`. Returns the
 * messages to append to the transcript, or null if the turn failed (an error
 * event has been emitted). Nothing is persisted here: the caller commits the
 * result atomically, so a failed turn leaves no trace.
 */
export async function runTurn(input: TurnInput, emit: (e: AgentEvent) => void): Promise<TurnResult | null> {
  const newMessages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: input.userContent }];
  let itinerary = input.itinerary;
  const commentReplies = new Map<string, TurnResult["commentReplies"][number]>();

  let reply = "";
  let continuations = 0;
  let jsonRetries = 0;

  try {
    while (true) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        system: SYSTEM_PROMPT,
        tools,
        messages: [...input.history, ...newMessages],
        output_config: { effort: EFFORT },
        cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      stream.on("text", (delta) => {
        reply += delta;
        emit({ type: "text", text: delta });
      });
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          emit({
            type: "status",
            text: event.content_block.name === "update_itinerary" ? "Writing the itinerary…" : "Replying to comments…",
          });
        }
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use") emit({ type: "status", text: describeServerTool(block) });
      });

      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // With eager input streaming, unparseable tool JSON rejects here. The
        // SDK has no dedicated class for it (it's a bare AnthropicError, like
        // stream-level credential failures), so match its message. Re-issue
        // for that case only; everything else propagates.
        const badToolJson =
          err instanceof Anthropic.AnthropicError &&
          !(err instanceof Anthropic.APIError) &&
          err.message.startsWith("Unable to parse tool parameter JSON");
        if (!badToolJson || jsonRetries++ >= 2) throw err;
        emit({ type: "status", text: "Retrying a malformed tool call…" });
        continue;
      }

      if (message.stop_reason === "refusal") {
        throw new TurnFailed("The model declined this request. Try rephrasing it.");
      }

      newMessages.push({ role: "assistant", content: message.content });

      if (message.stop_reason === "pause_turn") {
        // The server-side search loop hit its iteration limit; re-sending
        // resumes it.
        if (++continuations > MAX_CONTINUATIONS) throw new TurnFailed("The agent ran too long on this request.");
        continue;
      }

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;

      if (message.stop_reason === "max_tokens") {
        throw new TurnFailed("The itinerary was too long to write in one response. Try asking for a shorter trip.");
      }

      const results = toolUses.map((tool): Anthropic.Beta.BetaToolResultBlockParam => {
        const fail = (content: string) => ({ type: "tool_result" as const, tool_use_id: tool.id, is_error: true, content });
        const ok = (content: string) => ({ type: "tool_result" as const, tool_use_id: tool.id, content });

        if (tool.name === "update_itinerary") {
          const parsed = Itinerary.safeParse(tool.input);
          if (!parsed.success) return fail(`Invalid itinerary: ${parsed.error.message}`);
          const changed = normalizeIds(parsed.data);
          itinerary = parsed.data;
          emit({ type: "itinerary", itinerary: parsed.data });
          const note = changed.length ? ` Fixed missing or duplicate ids: ${changed.join(", ")}.` : "";
          return ok(`Itinerary updated: ${parsed.data.days.length} days, shown to everyone on the trip.${note}`);
        }

        if (tool.name === "reply_to_comments") {
          const parsed = CommentReplies.safeParse(tool.input);
          if (!parsed.success) return fail(`Invalid input: ${parsed.error.message}`);
          const unknown = parsed.data.replies.filter((r) => !input.openThreads.has(r.thread_id)).map((r) => r.thread_id);
          for (const r of parsed.data.replies) {
            if (input.openThreads.has(r.thread_id)) {
              commentReplies.set(r.thread_id, { threadId: r.thread_id, message: r.message, resolve: r.resolve });
            }
          }
          const note = unknown.length ? ` Ignored unknown or already-resolved threads: ${unknown.join(", ")}.` : "";
          return ok(`Replies will be posted when this turn finishes.${note}`);
        }

        return fail(`Unknown tool ${tool.name}`);
      });
      newMessages.push({ role: "user", content: results });
      continuations = 0;
      reply += reply && !reply.endsWith("\n") ? "\n\n" : "";
    }
  } catch (err) {
    emit({ type: "error", message: errorMessage(err) });
    return null;
  }

  return { newMessages, reply: reply.trim(), itinerary, commentReplies: [...commentReplies.values()] };
}

function describeServerTool(block: Anthropic.Beta.BetaServerToolUseBlock): string {
  const input = block.input as { query?: string; url?: string };
  if (block.name === "web_search" && input.query) return `Searching: ${input.query}`;
  if (block.name === "web_fetch" && input.url) return `Reading: ${input.url}`;
  return "Researching…";
}

function errorMessage(err: unknown): string {
  if (err instanceof TurnFailed) return err.message;
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic credentials are missing or invalid. Set ANTHROPIC_API_KEY in .env and restart the server.";
  }
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  // The SDK raises a plain Error (no typed class) when it finds no credentials.
  if (err instanceof Error && err.message.startsWith("Could not resolve authentication method")) {
    return "No Anthropic credentials found. Set ANTHROPIC_API_KEY in .env and restart the server.";
  }
  console.error(err);
  return "Something went wrong while planning. Check the server log.";
}
