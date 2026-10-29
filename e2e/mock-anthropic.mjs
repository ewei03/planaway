// A stand-in for the Anthropic Messages API, so end-to-end tests exercise the
// real agent loop (streaming, tool calls, commits) without an API key or cost.
// PlanAway reaches it through ANTHROPIC_BASE_URL; see playwright.config.ts.
//
// Script: a user message gets a short reply plus an update_itinerary call
// with the fixture itinerary (and reply_to_comments for any threads listed in
// <new_comments>). The follow-up request carrying the tool results gets a
// final text reply. A message containing "FAIL" gets a 400 error.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 3101);
const itinerary = JSON.parse(readFileSync(new URL("../tests/fixtures/itinerary.json", import.meta.url), "utf8"));

function textOf(content) {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function respond(messages) {
  const last = messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) {
    return { blocks: [{ type: "text", text: "Your trip is ready. Want me to add a day trip?" }], stop: "end_turn" };
  }
  const text = textOf(last.content);
  const threads = [...text.matchAll(/thread_id=([0-9a-f-]{36})/g)].map((m) => m[1]);
  const blocks = [
    { type: "text", text: threads.length ? "Updated the plan from your comments." : "Planning **Kyoto** for you." },
    { type: "tool_use", id: "toolu_itinerary", name: "update_itinerary", input: itinerary },
  ];
  if (threads.length) {
    blocks.push({
      type: "tool_use",
      id: "toolu_comments",
      name: "reply_to_comments",
      input: { replies: threads.map((thread_id) => ({ thread_id, message: "Moved it earlier in the day.", resolve: true })) },
    });
  }
  return { blocks, stop: "tool_use" };
}

function streamMessage(res, { blocks, stop }) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "mock",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } });
  send("message_stop", {});
  res.end();
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return res.end("ok");
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw);
    if (textOf(body.messages.at(-1).content).includes("FAIL")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "mock failure" } }));
      return;
    }
    streamMessage(res, respond(body.messages));
  });
}).listen(port, () => console.log(`Mock Anthropic API on http://localhost:${port}`));
