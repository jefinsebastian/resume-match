// POST /api/jd  { url }  ->  { title, company, location, country, text, source }
// Reads a job posting from a link. Order of attempts:
//   1. Site APIs that return clean data: LinkedIn (guest job API), Greenhouse, Lever, Ashby, SmartRecruiters
//   2. schema.org JobPosting data embedded in the page (most career sites, Indeed, Workday, Naukri when served)
//   3. The page's main text
// Requires the same APP_PASSCODE as /api/claude so the endpoint can't be used as an open proxy.

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", hellip: "…", rupee: "₹" };
function decode(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
// HTML -> readable text, keeping paragraph and list structure
function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<li[^>]*>/gi, "\n• ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|ul|ol|section|tr)>/gi, "\n").replace(/<(p|h[1-6]|ul|ol|section)[^>]*>/gi, "\n");
  s = decode(s.replace(/<[^>]+>/g, " "));
  return s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function isPrivateHost(h) {
  h = h.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]" || /^\[?f[cd]/.test(h);
}
async function get(url, accept = "text/html,application/json") {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept, "accept-language": "en-IN,en;q=0.9" }, redirect: "follow", signal: ac.signal });
    const body = (await r.text()).slice(0, 3_000_000);
    return { ok: r.ok, status: r.status, body, finalUrl: r.url };
  } finally { clearTimeout(t); }
}
const COUNTRY = { IN: "India", INDIA: "India", AE: "UAE / Gulf", UAE: "UAE / Gulf", "UNITED ARAB EMIRATES": "UAE / Gulf", SA: "UAE / Gulf", QA: "UAE / Gulf", GB: "United Kingdom", UK: "United Kingdom", "UNITED KINGDOM": "United Kingdom", CA: "Canada", CANADA: "Canada", US: "United States", USA: "United States", "UNITED STATES": "United States" };
const toRegion = c => COUNTRY[String(c || "").trim().toUpperCase()] || "";
function guessRegion(loc) {
  const l = String(loc || "").toLowerCase();
  if (/india|bengaluru|bangalore|mumbai|delhi|gurugram|gurgaon|noida|hyderabad|pune|chennai|kolkata/.test(l)) return "India";
  if (/dubai|abu dhabi|uae|united arab emirates|sharjah|riyadh|doha|qatar|saudi/.test(l)) return "UAE / Gulf";
  if (/london|manchester|united kingdom|\buk\b|england|scotland/.test(l)) return "United Kingdom";
  if (/canada|toronto|vancouver|montreal|calgary|ottawa/.test(l)) return "Canada";
  if (/united states|\busa\b|new york|san francisco|seattle|austin|boston|chicago/.test(l)) return "United States";
  if (/remote/.test(l)) return "Remote / global";
  return "";
}
function finish(o, source) {
  const text = (o.text || "").slice(0, 20000);
  const loc = o.location || "";
  return { title: (o.title || "").trim(), company: (o.company || "").trim(), location: loc.trim(), region: toRegion(o.country) || guessRegion(loc), text, source };
}

/* 1. site APIs */
async function trySiteApis(u) {
  const host = u.hostname.replace(/^www\./, "");
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = u.searchParams.get("currentJobId") || (u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/) || [])[1];
    if (id) {
      const r = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
      if (r.ok) {
        const h = r.body;
        const desc = (h.match(/<div class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
        const title = htmlToText((h.match(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
        const company = htmlToText((h.match(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
        const location = htmlToText((h.match(/topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
        const crit = htmlToText((h.match(/<ul class="description__job-criteria-list">([\s\S]*?)<\/ul>/) || [])[1]);
        if (desc) return finish({ title, company, location, text: htmlToText(desc) + (crit ? "\n\n" + crit : "") }, "LinkedIn");
      }
    }
  }
  if (/greenhouse\.io$/.test(host)) {
    const m = u.pathname.match(/^\/(?:embed\/job_app\?for=)?([^/]+)\/jobs\/(\d+)/) || [];
    const board = m[1] || u.searchParams.get("for"), id = m[2] || u.searchParams.get("token");
    if (board && id) {
      const r = await get(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`, "application/json");
      if (r.ok) { const d = JSON.parse(r.body); return finish({ title: d.title, company: board, location: d.location && d.location.name, text: htmlToText(decode(d.content)) }, "Greenhouse"); }
    }
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const [, co, id] = u.pathname.split("/");
    if (co && id) {
      const api = host === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
      const r = await get(`https://${api}/v0/postings/${co}/${id}`, "application/json");
      if (r.ok) {
        const d = JSON.parse(r.body);
        const lists = (d.lists || []).map(l => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
        return finish({ title: d.text, company: co, location: d.categories && d.categories.location, country: d.country, text: [d.descriptionPlain, lists, d.additionalPlain].filter(Boolean).join("\n\n") }, "Lever");
      }
    }
  }
  if (host === "jobs.ashbyhq.com") {
    const [, org, id] = u.pathname.split("/");
    if (org && id) {
      const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`, "application/json");
      if (r.ok) { const j = (JSON.parse(r.body).jobs || []).find(x => x.id === id); if (j) return finish({ title: j.title, company: org, location: j.location, text: j.descriptionPlain || htmlToText(j.descriptionHtml) }, "Ashby"); }
    }
  }
  if (host === "jobs.smartrecruiters.com") {
    const [, co, idslug] = u.pathname.split("/"); const id = (idslug || "").split("-")[0];
    if (co && id) {
      const r = await get(`https://api.smartrecruiters.com/v1/companies/${co}/postings/${id}`, "application/json");
      if (r.ok) { const d = JSON.parse(r.body); const s = (d.jobAd && d.jobAd.sections) || {};
        return finish({ title: d.name, company: d.company && d.company.name, location: d.location && [d.location.city, d.location.country].filter(Boolean).join(", "), country: d.location && d.location.country,
          text: ["companyDescription", "jobDescription", "qualifications", "additionalInformation"].map(k => s[k] && `${s[k].title}\n${htmlToText(s[k].text)}`).filter(Boolean).join("\n\n") }, "SmartRecruiters"); }
    }
  }
  return null;
}

/* 2. schema.org JobPosting */
function findJobPosting(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findJobPosting(n); if (f) return f; } return null; }
  const t = node["@type"]; if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return node;
  return findJobPosting(node["@graph"]) || null;
}
function fromJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const jp = findJobPosting(data); if (!jp || !jp.description) continue;
    const org = jp.hiringOrganization; const loc = [].concat(jp.jobLocation || [])[0]; const addr = loc && loc.address || {};
    const place = typeof addr === "string" ? addr : [addr.addressLocality, addr.addressRegion, addr.addressCountry && (addr.addressCountry.name || addr.addressCountry)].filter(Boolean).join(", ");
    const extras = [jp.qualifications, jp.responsibilities, jp.skills, jp.experienceRequirements && (jp.experienceRequirements.description || jp.experienceRequirements)].filter(x => typeof x === "string").map(htmlToText);
    return finish({ title: jp.title, company: org && (org.name || org), location: jp.jobLocationType === "TELECOMMUTE" ? `Remote${place ? ", " + place : ""}` : place,
      country: addr.addressCountry && (addr.addressCountry.name || addr.addressCountry), text: [htmlToText(decode(jp.description)), ...extras].join("\n\n") }, "Job posting data");
  }
  return null;
}

/* 3. page text */
function fromPage(html) {
  const title = htmlToText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  let body = (html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<body[\s\S]*<\/body>/i) || [html])[0];
  body = body.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");
  return finish({ title, text: htmlToText(body) }, "Page text");
}
const looksBlocked = (t) => /sign in to|log ?in to (view|continue)|enable javascript|access denied|are you a robot|captcha|request blocked|just a moment/i.test(t.slice(0, 600)) && t.length < 2500;

export async function onRequestPost({ request, env }) {
  if (env.APP_PASSCODE && request.headers.get("x-app-key") !== env.APP_PASSCODE) return json({ error: "passcode", message: "Passcode required." }, 401);
  let url; try { ({ url } = await request.json()); url = new URL(String(url || "").trim()); } catch { return json({ error: "bad_url", message: "That doesn't look like a valid link." }, 400); }
  if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) return json({ error: "bad_url", message: "Use a public job link that starts with https://." }, 400);
  try {
    let out = await trySiteApis(url).catch(() => null);
    if (!out || out.text.length < 200) {
      const r = await get(url.toString());
      if (!r.ok && r.status !== 200) {
        const blocked = r.status === 403 || r.status === 429 || r.status === 999;
        return json({ error: "fetch_failed", message: blocked ? "This job site blocks automatic reading. Paste the description instead." : `The job page didn't load (error ${r.status}). Check the link, or paste the description.` }, 422);
      }
      out = fromJsonLd(r.body) || fromPage(r.body);
      if (out.source === "Page text" && (out.text.length < 400 || looksBlocked(out.text)))
        return json({ error: "no_content", message: "This page needs a sign-in or loads the job with scripts, so it can't be read automatically. Paste the description instead." }, 422);
    }
    if (out.text.length < 200) return json({ error: "no_content", message: "Couldn't find a job description on that page. Paste it instead." }, 422);
    return json(out);
  } catch (e) {
    return json({ error: "fetch_failed", message: e && e.name === "AbortError" ? "The job page took too long to respond. Paste the description instead." : "Couldn't read that page. Paste the description instead." }, 422);
  }
}
export const onRequest = () => json({ error: "method", message: "Use POST." }, 405);
