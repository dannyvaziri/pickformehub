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

const promptFor = (query) => `You are PickForMeHub, an evidence-first buying researcher.\n\nUser request: ${query}\n\nUse web search to research current information. Recommend exactly three physical products that can reasonably be purchased on Amazon.com. Do not recommend SaaS, subscriptions, services, or products that are not normally sold on Amazon. Prefer products with clear current availability and explain uncertainty. Return ONLY valid JSON in this shape: {"summary":"...","budget_note":"...","picks":[{"name":"...","label":"Best overall|Best value|Best for this use","price":"...","score":0,"why":["...","..."],"tradeoffs":["..."],"sources":[{"title":"...","url":"https://..."}]}]}. Scores must be numbers from 1 to 10. Never invent a URL; omit a source URL you cannot verify.`;

async function requestGroq(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: groqModel, messages: [{ role: "user", content: prompt }], tools: [{ type: "browser_search" }], tool_choice: "required", temperature: 0.2, max_completion_tokens: 1200 }),
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
    body: JSON.stringify({ model: openRouterModel, messages: [{ role: "user", content: prompt }], tools: [{ type: "openrouter:web_search" }], temperature: 0.2, max_tokens: 1200 }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "OpenRouter research request failed");
  return extractJson(payload?.choices?.[0]?.message?.content || "");
}

async function research(query) {
  const prompt = promptFor(query);
  let result;
  const errors = [];
  try { result = await requestGroq(prompt); } catch (error) { errors.push(`Groq: ${error.message}`); }
  if (!result) {
    try { result = await requestOpenRouter(prompt); } catch (error) { errors.push(`OpenRouter: ${error.message}`); }
  }
  if (!result) throw new Error(`No research provider is available. ${errors.join(" ")}`);
  result.picks = Array.isArray(result.picks) ? result.picks.slice(0, 3).map((pick) => ({
    ...pick,
    score: Math.max(1, Math.min(10, Number(pick.score) || 0)),
    amazonUrl: amazonUrl(pick.name),
  })) : [];
  result.researchedAt = new Date().toISOString();
  result.affiliateDisclosure = "We may earn a commission from qualifying Amazon purchases. This does not influence our rankings.";
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
