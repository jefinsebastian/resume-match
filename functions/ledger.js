// Activity and cost ledger, stored in a SQLite-backed Durable Object (free on Cloudflare Workers).
// One object ("main") holds every event, so all devices see the same history.
import { DurableObject } from "cloudflare:workers";

// Anthropic list prices in USD per million tokens. Override with PRICE_IN_PER_MTOK / PRICE_OUT_PER_MTOK if you change models.
const PRICES = [
  [/sonnet/i, 2, 10],
];
export function priceFor(model, env) {
  const inp = parseFloat(env.PRICE_IN_PER_MTOK), out = parseFloat(env.PRICE_OUT_PER_MTOK);
  if (inp >= 0 && out >= 0) return { in: inp, out, estimated: false };
  const hit = PRICES.find(([re]) => re.test(model || ""));
  return hit ? { in: hit[1], out: hit[2], estimated: false } : { in: 2, out: 10, estimated: true };
}
export function costUsd(model, usage, env) {
  const p = priceFor(model, env);
  const u = usage || {};
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  return { usd: (inTok * p.in + (u.output_tokens || 0) * p.out) / 1e6, estimated: p.estimated };
}
export const jobKey = (title, company) => {
  const k = [title, company].map(s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
  return k || null;
};

export class Ledger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
      job TEXT, company TEXT, jobkey TEXT, model TEXT,
      in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, ok INTEGER DEFAULT 1,
      device TEXT, detail TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS apps(
      jobkey TEXT PRIMARY KEY, title TEXT, company TEXT, link TEXT, status TEXT DEFAULT 'Scored',
      fit INTEGER, kw INTEGER, first_ts INTEGER, last_ts INTEGER)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ev_ts ON events(ts)`);
  }
  add(e) {
    const ts = Date.now();
    const key = e.jobkey || null;
    this.sql.exec(`INSERT INTO events(ts,type,job,company,jobkey,model,in_tok,out_tok,cost_usd,ok,device,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      ts, String(e.type || "event").slice(0, 40), e.job ? String(e.job).slice(0, 200) : null, e.company ? String(e.company).slice(0, 200) : null, key,
      e.model || null, e.in_tok | 0, e.out_tok | 0, +e.cost_usd || 0, e.ok === false ? 0 : 1, e.device ? String(e.device).slice(0, 60) : null,
      e.detail ? String(e.detail).slice(0, 500) : null);
    if (key) this.upsertApp({ ...e, jobkey: key }, ts);
    return { ok: true };
  }
  upsertApp(e, ts = Date.now()) {
    if (!e.jobkey) return { ok: false };
    this.sql.exec(`INSERT INTO apps(jobkey,title,company,link,fit,kw,first_ts,last_ts) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(jobkey) DO UPDATE SET last_ts=excluded.last_ts,
        link=COALESCE(excluded.link, apps.link), fit=COALESCE(excluded.fit, apps.fit), kw=COALESCE(excluded.kw, apps.kw),
        title=COALESCE(apps.title, excluded.title), company=COALESCE(apps.company, excluded.company)`,
      e.jobkey, e.job || null, e.company || null, e.link || null, Number.isFinite(e.fit) ? Math.round(e.fit) : null, Number.isFinite(e.kw) ? Math.round(e.kw) : null, ts, ts);
    return { ok: true };
  }
  setStatus(jobkey, status) {
    const allowed = ["Scored", "Applied", "Interviewing", "Offer", "Rejected", "Not applying"];
    if (!allowed.includes(status)) return { ok: false };
    this.sql.exec(`UPDATE apps SET status=?, last_ts=? WHERE jobkey=?`, status, Date.now(), jobkey);
    return { ok: true };
  }
  deleteApp(jobkey) {
    this.sql.exec(`DELETE FROM apps WHERE jobkey=?`, jobkey);
    return { ok: true };
  }
  dashboard(tzOffsetMin = 330) {
    const rows = q => [...this.sql.exec(q).toArray()];
    const totals = rows(`SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd, COALESCE(SUM(in_tok),0) in_tok, COALESCE(SUM(out_tok),0) out_tok FROM events`)[0];
    const now = new Date(Date.now() + tzOffsetMin * 60000);
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - tzOffsetMin * 60000;
    const month = [...this.sql.exec(`SELECT COALESCE(SUM(cost_usd),0) usd, COUNT(*) n FROM events WHERE ts>=?`, monthStart).toArray()][0];
    const byType = rows(`SELECT type, COUNT(*) n, SUM(in_tok) in_tok, SUM(out_tok) out_tok, SUM(cost_usd) usd, SUM(1-ok) failed FROM events GROUP BY type ORDER BY usd DESC, n DESC`);
    const since = Date.now() - 30 * 86400000;
    const daily = [...this.sql.exec(`SELECT CAST((ts + ?) / 86400000 AS INTEGER) d, SUM(cost_usd) usd, COUNT(*) n FROM events WHERE ts>=? GROUP BY d ORDER BY d`, tzOffsetMin * 60000, since).toArray()];
    const apps = rows(`SELECT a.*, COALESCE(e.usd,0) usd, COALESCE(e.n,0) n,
        COALESCE(e.scores,0) scores, COALESCE(e.builds,0) builds, COALESCE(e.downloads,0) downloads
      FROM apps a LEFT JOIN (SELECT jobkey, SUM(cost_usd) usd, COUNT(*) n,
        SUM(type IN ('score','score_saved')) scores, SUM(type='tailor') builds, SUM(type LIKE 'download%') downloads
        FROM events WHERE jobkey IS NOT NULL GROUP BY jobkey) e ON e.jobkey=a.jobkey ORDER BY a.last_ts DESC`);
    const events = rows(`SELECT * FROM events ORDER BY id DESC LIMIT 400`);
    return { totals, month, byType, daily, apps, events };
  }
  exportAll() { return [...this.sql.exec(`SELECT * FROM events ORDER BY id`).toArray()]; }
}

export const ledgerOf = env => (env && env.LEDGER ? env.LEDGER.get(env.LEDGER.idFromName("main")) : null);
export async function logEvent(env, ctx, e) {
  const l = ledgerOf(env); if (!l) return;
  const p = l.add(e).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
}
