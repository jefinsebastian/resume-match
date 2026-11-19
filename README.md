# Resume Match

Score your resume against any job description: ATS check, keyword match, job fit, and a tailored resume you can download as .docx or PDF. Installable on Android and iPhone as an app (PWA).

## Reading jobs from a link

Paste a job link and tap **Read job**. The server reads LinkedIn job pages, Greenhouse, Lever, Ashby and SmartRecruiters through their public job data, and any career page that includes standard job-posting data. Sites that need a sign-in or block bots, such as Naukri, show a message asking you to paste the description instead.

## How it's built

- `public/`: the app, a single `index.html` plus the manifest, service worker and icons. No build step.
- `worker.js` + `functions/api/claude.js`: the Cloudflare Worker that calls the Anthropic API. Your API key stays on the server and never reaches the browser.

## Deploy on Cloudflare (Workers)

`wrangler.jsonc` and `worker.js` make this a Worker that serves `public/` and handles `POST /api/claude`.

1. Go to **Workers & Pages → Create → Import a repository** and pick this repo. Keep the deploy command `npx wrangler deploy` and leave the build command empty.
2. In the Worker, open **Settings → Variables and Secrets** and add these with type **Secret**:
   - `ANTHROPIC_API_KEY`: your key from console.anthropic.com
   - `APP_PASSCODE`: any passcode. The app asks for it once on each device.
   - `ANTHROPIC_MODEL` (optional): defaults to `claude-sonnet-5-5`
   - `SCORE_MODEL` / `TAILOR_MODEL` (optional): use a different model for scoring or for resume writing, for example a cheaper Haiku model for scoring
3. Every push to `main` redeploys automatically.
4. Optional custom domain: go to **Settings → Domains & Routes → Add → Custom domain**, for example `resume.jefinsebastian.com`.

The Worker name in `wrangler.jsonc` must match the Worker's name in Cloudflare (`resume-match`).

## Install on your phone

- **Android (Chrome):** open the site, then tap **⋮ → Add to Home screen → Install**.
- **iPhone:** open the site in **Safari**, not inside another app. Tap **Share** (on newer iOS it may be under the **⋯** menu), then **Add to Home Screen**, keep **Open as Web App** on, and tap **Add**. The app shows these steps itself on iPhone.

## Dashboard

The chart button in the top bar opens **Activity & costs**. Every AI call is logged with the exact tokens Anthropic reports and its cost in ₹ and $. Job link reads, downloads and saved-score reuses are logged too, as free actions. Jobs are grouped into an applications table where you can set a status (Applied, Interviewing, Offer…), and you can export everything as CSV. The log lives in a SQLite Durable Object (`Ledger`), which is free on Cloudflare's Workers plan and needs no setup: `wrangler.jsonc` declares it.

Optional variables: `USD_INR` (default 94) and `PRICE_IN_PER_MTOK` / `PRICE_OUT_PER_MTOK` if you switch to a model with different pricing.

## Cost

Scoring the same resume against the same job again loads the saved result instantly, at no cost. Tap "Score again with AI" to force a fresh score.


You pay Anthropic per use. One score plus one tailored resume is roughly 10–15k input tokens and 4–6k output tokens on Sonnet, which comes to a few rupees per job. Set a monthly spend limit in the Anthropic console.

## Privacy

Your resume and last report are saved only in your phone's browser storage. They're sent to the Anthropic API only when you run an analysis.
