// GET  /api/ledger            -> dashboard data   (?format=csv -> every event as CSV)
// POST /api/ledger { action } -> "event" (client-side actions, no AI cost), "app" (update fit/keyword scores), "status", "delete_app"
import { ledgerOf, jobKey, logEvent } from "../ledger.js";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const CLIENT_EVENTS = ["download_docx", "download_pdf", "score_saved"];

export async function onRequest({ request, env, ctx }) {
  if (env.APP_PASSCODE && request.headers.get("x-app-key") !== env.APP_PASSCODE) return json({ error: "passcode", message: "Passcode required." }, 401);
  const ledger = ledgerOf(env);
  if (!ledger) return json({ error: "no_ledger", message: "The activity log isn't switched on yet on your server, so nothing is being recorded. Everything else in the app works normally." }, 501);
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.get("format") === "csv") {
      const rows = await ledger.exportAll(), rate = parseFloat(env.USD_INR) || 94;
      const cols = ["id", "time", "type", "job", "company", "model", "in_tok", "out_tok", "cost_usd", "cost_inr", "ok", "device", "detail"];
      const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [cols.join(","), ...rows.map(r => cols.map(c => esc(c === "time" ? new Date(r.ts).toISOString() : c === "cost_inr" ? (r.cost_usd * rate).toFixed(2) : c === "cost_usd" ? (+r.cost_usd).toFixed(5) : r[c])).join(","))].join("\n");
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
    }
    const tz = parseInt(url.searchParams.get("tz") || "330", 10);
    const data = await ledger.dashboard(Number.isFinite(tz) ? tz : 330);
    return json({ ...data, usd_inr: parseFloat(env.USD_INR) || 94, model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", score_model: env.SCORE_MODEL || null, tailor_model: env.TAILOR_MODEL || null });
  }
  if (request.method !== "POST") return json({ error: "method" }, 405);
  let b; try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (b.action === "event" && CLIENT_EVENTS.includes(b.type)) {
    await logEvent(env, ctx, { type: b.type, job: b.job, company: b.company, jobkey: jobKey(b.job, b.company), link: b.link, device: b.device, cost_usd: 0, detail: b.detail });
    return json({ ok: true });
  }
  if (b.action === "app") return json(await ledger.upsertApp({ jobkey: jobKey(b.job, b.company), job: b.job, company: b.company, link: b.link, fit: +b.fit, kw: +b.kw }));
  if (b.action === "status") return json(await ledger.setStatus(String(b.jobkey || ""), String(b.status || "")));
  if (b.action === "delete_app") return json(await ledger.deleteApp(String(b.jobkey || "")));
  return json({ error: "bad_request" }, 400);
}
