import { composeUserMessage, runTurn, type AgentEvent } from "@/lib/agent";
import { body, handler, jsonError, requireUser, str, type IdParams } from "@/lib/http";
import { claimTurn, commitTurn, getTripRevision, loadTurnContext, releaseTurn } from "@/lib/store";

// Sends a message to the agent and streams its progress back as Server-Sent
// Events. The turn keeps running if the browser disconnects, so work isn't
// lost; the result is committed in one transaction when it finishes.
export const POST = handler(async (req: Request, { params }: IdParams) => {
  const user = await requireUser();
  const tripId = (await params).id;
  const text = str((await body(req)).text, 8000);
  if (!text) return jsonError("Message text is required.", 400);

  if (!(await claimTurn(user.id, tripId))) {
    const { busy } = await getTripRevision(user.id, tripId);
    const who = busy?.name ?? "Someone";
    return jsonError(`${who} is already asking PlanAway about this trip. Try again when that finishes.`, 409);
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false; // client went away
        }
      };
      const send = (event: AgentEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15000);
      try {
        const ctx = await loadTurnContext(tripId);
        const userContent = composeUserMessage({
          authorName: user.name,
          text,
          firstTurn: ctx.history.length === 0,
          newComments: ctx.newComments,
        });
        const result = await runTurn(
          { history: ctx.history, userContent, itinerary: ctx.itinerary, openThreads: ctx.openThreads },
          send,
        );
        if (result) {
          await commitTurn(tripId, {
            userId: user.id,
            userText: text,
            reply: result.reply,
            startSeq: ctx.history.length,
            newMessages: result.newMessages,
            itinerary: result.itinerary,
            commentReplies: result.commentReplies,
            commentsSeenAt: ctx.startedAt,
          });
          send({ type: "done", reply: result.reply });
        }
      } catch (err) {
        console.error(err);
        send({ type: "error", message: "Failed to save this turn." });
      } finally {
        clearInterval(heartbeat);
        await releaseTurn(tripId).catch((err) => console.error("Failed to release turn lock", err));
        if (open) controller.close();
        open = false;
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
