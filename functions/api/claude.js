// Cloudflare Pages Function: POST /api/claude  { prompt }  ->  { text, stop_reason }
// Keeps your Anthropic API key on the server. Set these in Cloudflare Pages > Settings > Variables and Secrets:
//   ANTHROPIC_API_KEY  (required, secret)
//   APP_PASSCODE       (recommended, secret) - the app asks for it once per device
//   ANTHROPIC_MODEL    (optional) - defaults to claude-sonnet-5-5
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (env.APP_PASSCODE && request.headers.get("x-app-key") !== env.APP_PASSCODE) {
    return json({ error: "passcode", message: "Passcode required." }, 401);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "config", message: "The server has no ANTHROPIC_API_KEY set. Add it in Cloudflare Pages settings and redeploy." }, 500);
  }
  let prompt;
  try { ({ prompt } = await request.json()); } catch { return json({ error: "bad_request", message: "Invalid request." }, 400); }
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 60000) {
    return json({ error: "bad_request", message: "The resume or job description is empty or too long." }, 400);
  }
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 300);
    const msg = upstream.status === 401 ? "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY."
      : upstream.status === 429 ? "Rate limited by the AI service. Wait a minute and try again."
      : upstream.status === 529 ? "The AI service is busy. Try again in a moment."
      : "The AI service returned an error. Try again.";
    console.log("anthropic error", upstream.status, detail);
    return json({ error: "upstream", message: msg }, upstream.status === 429 ? 429 : 502);
  }
  const data = await upstream.json();
  const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  return json({ text, stop_reason: data.stop_reason });
}

export const onRequest = () => json({ error: "method", message: "Use POST." }, 405);
