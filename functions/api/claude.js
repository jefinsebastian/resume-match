// Cloudflare Pages Function: POST /api/claude  { prompt }  ->  { text, stop_reason }
// Keeps your Anthropic API key on the server. Set these in Cloudflare Pages > Settings > Variables and Secrets:
//   ANTHROPIC_API_KEY  (required, secret)
//   APP_PASSCODE       (recommended, secret) - the app asks for it once per device
//   ANTHROPIC_MODEL    (optional) - model for everything; defaults to claude-sonnet-5-5
//   SCORE_MODEL        (optional) - model just for scoring, e.g. a cheaper Haiku model
//   TAILOR_MODEL       (optional) - model just for writing the tailored resume
import { costUsd, logEvent, jobKey } from "../ledger.js";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env, ctx }) {
  if (env.APP_PASSCODE && request.headers.get("x-app-key") !== env.APP_PASSCODE) {
    return json({ error: "passcode", message: "Passcode required." }, 401);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "config", message: "The server has no ANTHROPIC_API_KEY set. Add it in Cloudflare Pages settings and redeploy." }, 500);
  }
  let prompt, kind, meta;
  try { ({ prompt, kind, meta } = await request.json()); } catch { return json({ error: "bad_request", message: "Invalid request." }, 400); }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 60000) {
    return json({ error: "bad_request", message: "The resume or job description is empty or too long." }, 400);
  }
  meta = meta && typeof meta === "object" ? meta : {};
  const model = (kind === "tailor" ? env.TAILOR_MODEL : kind === "score" ? env.SCORE_MODEL : null) || env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const type = kind === "tailor" ? "tailor" : kind === "score" ? "score" : "ai";
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: kind === "tailor" ? 5000 : 6000,   // caps the spend per call; both outputs are well under this
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 300);
    const msg = upstream.status === 401 ? "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY."
      : upstream.status === 429 ? "Rate limited by the AI service. Wait a minute and try again."
      : upstream.status === 529 ? "The AI service is busy. Try again in a moment."
      : "The AI service returned an error. Try again.";
    console.log("anthropic error", upstream.status, detail);
    await logEvent(env, ctx, { type, job: meta.job, company: meta.company, model, ok: false, device: meta.device, detail: `AI error ${upstream.status}` });
    return json({ error: "upstream", message: msg }, upstream.status === 429 ? 429 : 502);
  }
  const data = await upstream.json();
  const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const usage = data.usage || {};
  const cost = costUsd(data.model || model, usage, env);
  let job = meta.job, company = meta.company;
  if (type === "score" && !job) { try { const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).job || {}; job = j.title; company = j.company; } catch {} }
  const usdInr = parseFloat(env.USD_INR) || 94;
  await logEvent(env, ctx, { type, job, company, jobkey: type === "ai" ? null : jobKey(job, company), link: meta.link, model: data.model || model,
    in_tok: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0), out_tok: usage.output_tokens || 0,
    cost_usd: cost.usd, ok: data.stop_reason !== "max_tokens", device: meta.device, detail: cost.estimated ? "price estimated" : null });
  return json({ text, stop_reason: data.stop_reason, usage, cost_usd: cost.usd, cost_inr: cost.usd * usdInr, job, company });
}

export const onRequest = () => json({ error: "method", message: "Use POST." }, 405);
