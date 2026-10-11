import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3000);
const associateTag = process.env.AMAZON_ASSOCIATE_TAG || "pickformehub-20";
const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const openRouterModel = process.env.OPENROUTER_MODEL || "openrouter/free";
const useAiResearch = process.env.USE_AI_RESEARCH === "true";
const searchIndex = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) return res.end(body);
  res.end(JSON.stringify(body));
}

function amazonUrl(product) {
  const query = encodeURIComponent(product);
  return `https://www.amazon.com/s?k=${query}&tag=${encodeURIComponent(associateTag)}`;
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 12000) throw new Error("Request is too large");
  }
  return JSON.parse(data || "{}");
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The research provider returned an invalid result");
  return JSON.parse(candidate.slice(start, end + 1));
}

function fallbackResult(query, errors) {
  const text = query.toLowerCase();
  const groups = text.includes("monitor") || text.includes("macbook") || text.includes("dock") ? [
    ["Dell UltraSharp U2723QE 27-inch 4K USB-C Hub Monitor", "Best overall", "One-cable monitor setup with a sharp 4K display and built-in hub.", "Premium price; confirm your laptop supports the desired USB-C features."],
    ["Anker 565 USB-C Hub 11-in-1", "Best value", "Adds display, USB, card, and network connections to a laptop setup.", "Not a monitor; verify port and display compatibility."],
    ["LG 27UP850-W 27-inch 4K UHD USB-C Monitor", "Best for this use", "A strong 4K productivity display with USB-C connectivity.", "Stand adjustability and built-in hub features vary by setup."],
  ] : text.includes("chair") || text.includes("ergonomic") || text.includes("comfort") ? [
    ["Branch Ergonomic Chair", "Best overall", "A practical ergonomic chair for long work sessions.", "Check dimensions and return terms before buying."],
    ["HON Ignition 2.0 Office Chair", "Best value", "Adjustable support at a more approachable price point.", "Less design-forward than premium alternatives."],
    ["SIHOO M57 Ergonomic Office Chair", "Best for this use", "A budget-friendly mesh option with adjustable features.", "Fit varies; pay close attention to seat depth and user height."],
  ] : text.includes("webcam") || text.includes("zoom") || text.includes("microphone") || text.includes("video") ? [
    ["Logitech Brio 4K Webcam", "Best overall", "A dependable webcam for sharp calls and flexible framing.", "4K is most useful with good lighting and bandwidth."],
    ["Logitech C920s HD Pro Webcam", "Best value", "A proven 1080p webcam for everyday meetings.", "Fixed framing and older image quality than premium models."],
    ["FIFINE K669B USB Microphone", "Best for this use", "An inexpensive way to improve spoken audio over laptop microphones.", "Needs a stable desk position and does not include advanced controls."],
  ] : [
    ["Flexispot Electric Standing Desk", "Best overall", "A flexible height-adjustable base for alternating sitting and standing.", "Measure your room and verify desktop size before ordering."],
    ["Amazon Basics Executive Office Desk Chair", "Best value", "A straightforward starting point for a budget workspace.", "Adjustability and long-session comfort are more limited."],
    ["Logitech MX Keys S Wireless Keyboard", "Best for this use", "A comfortable, quiet keyboard for laptop and desktop work.", "Keyboard feel is personal; it is not a mechanical option."],
  ];
  return {
    summary: "A practical starting shortlist for your workspace.",
    budget_note: "We matched real product types to your situation. Check current Amazon pricing, stock, fit, and return terms before buying.",
    picks: groups.map(([name, label, why, tradeoffs]) => ({ name, label, price: "Check current Amazon price", score: 0, why, tradeoffs })),
    provider: "curated-workspace-catalog",
    providerNotice: errors.join(" "),
  };
}

const promptFor = (query) => `Research this Amazon shopping request using web search: ${query}\nReturn ONLY compact valid JSON with exactly 3 physical Amazon products, no services: {"summary":"short","budget_note":"short","picks":[{"name":"product","label":"Best overall|Best value|Best for this use","price":"price or unknown","score":8,"why":"short reason","tradeoffs":"short caveat"}]}. Scores are 1-10. Do not include markdown, citations, or extra keys.`;

async function requestGroq(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: groqModel, messages: [{ role: "user", content: prompt }], tools: [{ type: "browser_search" }], tool_choice: "required", temperature: 0.2, max_completion_tokens: 800 }),
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Groq research request failed");
  return extractJson(payload?.choices?.[0]?.message?.content || "");
}

async function requestOpenRouter(prompt) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "HTTP-Referer": "https://pickformehub.com", "X-Title": "PickForMeHub" },
    body: JSON.stringify({ model: openRouterModel, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 800 }),
    signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "OpenRouter research request failed");
  return extractJson(payload?.choices?.[0]?.message?.content || "");
}

async function research(query) {
  const indexKey = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (searchIndex.has(indexKey)) return { ...searchIndex.get(indexKey), cached: true };
  const prompt = promptFor(query);
  let result;
  const errors = [];
  if (useAiResearch) {
    try { result = await requestGroq(prompt); } catch (error) { errors.push(`Groq: ${error.message}`); }
    if (!result) {
      try { result = await requestOpenRouter(prompt); } catch (error) { errors.push(`OpenRouter: ${error.message}`); }
    }
  }
  if (!result) result = fallbackResult(query, errors);
  result.picks = Array.isArray(result.picks) ? result.picks.slice(0, 3).map((pick) => ({
    ...pick,
    score: Math.max(1, Math.min(10, Number(pick.score) || 0)),
    amazonUrl: amazonUrl(pick.name),
  })) : [];
  result.researchedAt = new Date().toISOString();
  result.affiliateDisclosure = "We may earn a commission from qualifying Amazon purchases. This does not influence our rankings.";
  searchIndex.set(indexKey, result);
  return result;
}

async function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : (req.url || "/").split("?")[0];
  const safePath = normalize(requestPath).replace(/^([.][.][/\\])+/, "");
  const file = join(publicDir, safePath);
  if (!file.startsWith(publicDir)) return send(res, 403, { error: "Forbidden" });
  try {
    const body = await readFile(file);
    send(res, 200, body, mime[extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, service: "pickformehub" });
    if (req.method === "POST" && req.url === "/api/research") {
      const body = await readBody(req);
      const query = String(body.query || "").trim();
      if (query.length < 8) return send(res, 400, { error: "Tell us what you want to buy and include any budget or use case." });
      if (query.length > 500) return send(res, 400, { error: "Please keep the request under 500 characters." });
      return send(res, 200, await research(query));
    }
    if (req.method === "GET") return serveStatic(req, res);
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return send(res, 500, { error: error.message || "Something went wrong while researching." });
  }
});

server.listen(port, process.env.HOST || "0.0.0.0", () => console.log(`PickForMeHub listening on port ${port}`));
