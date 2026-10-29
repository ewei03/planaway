// A stand-in for the Anthropic Messages API (and the map and place services, below), so end-to-end tests exercise the
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

// ---------- Map and place stand-ins ----------
// NOMINATIM_URL, WIKIDATA_URL, COMMONS_URL, and MAP_STYLE_URL
// point here in playwright.config.ts.

const base = `http://localhost:${port}`;

// A 1×1 PNG, for every photo.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// A map style with no tiles: MapLibre renders a plain background, offline.
const STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e8efe9" } }] };

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const AIRPORTS = { SFO: [37.62, -122.38], KIX: [34.43, 135.24] };

/** Nominatim search: airports where they really are, everything else near Kyoto, "dinner" nowhere. */
function nominatim(q) {
  if (/dinner/i.test(q)) return [];
  const h = hash(q);
  const airport = AIRPORTS[q.replace(/ airport$/i, "").toUpperCase()];
  if (airport) {
    return [{ osm_type: "way", osm_id: h, lat: String(airport[0]), lon: String(airport[1]), name: `${q} (mock)`, display_name: q, extratags: null }];
  }
  return [
    {
      osm_type: "node",
      osm_id: h,
      lat: String(34.95 + (h % 100) / 1000),
      lon: String(135.7 + ((h >> 8) % 100) / 1000),
      name: q.split(",")[0],
      display_name: `${q}, Japan`,
      extratags: { wikidata: `Q${h}` },
    },
  ];
}

function json(res, data, headers = {}) {
  res.writeHead(200, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

/** Answers map and place requests; returns false for anything else. */
function maps(req, res) {
  const url = new URL(req.url, base);
  if (url.pathname === "/search") return json(res, nominatim(url.searchParams.get("q") ?? "")), true;
  if (url.pathname === "/w/api.php" && url.searchParams.get("action") === "wbgetclaims") {
    const qid = url.searchParams.get("entity");
    return json(res, { claims: { P18: [{ mainsnak: { datavalue: { value: `Mock ${qid}.jpg` } } }] } }), true;
  }
  if (url.pathname === "/w/api.php" && url.searchParams.get("action") === "query") {
    const file = (url.searchParams.get("titles") ?? "").replace(/^File:/, "").replace(/ /g, "_");
    const imageinfo = [
      {
        url: `${base}/img/${file}`,
        thumburl: `${base}/img/thumb/${file}/1280px-${file}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
        extmetadata: { Artist: { value: "<a href='#'>Mock Photographer</a>" }, LicenseShortName: { value: "CC BY 4.0" } },
      },
    ];
    return json(res, { query: { pages: { "-1": { imageinfo } } } }), true;
  }
  if (url.pathname.startsWith("/img/")) {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PIXEL);
    return true;
  }
  if (url.pathname === "/style.json") return json(res, STYLE, { "access-control-allow-origin": "*" }), true;
  return false;
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return res.end("ok");
  if (!req.url?.startsWith("/v1/messages")) {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => maps(req, res) || res.writeHead(404).end());
    return;
  }
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
