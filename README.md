# Resume Match

Score your resume against any job description: ATS check, keyword match, job fit, and a tailored resume you can download as .docx or PDF. Installable on Android and iPhone as an app (PWA).

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
- **iPhone (Safari):** open the site, then tap **Share → Add to Home Screen**.

## Cost

Scoring the same resume against the same job again loads the saved result instantly, at no cost. Tap "Score again with AI" to force a fresh score.


You pay Anthropic per use. One score plus one tailored resume is roughly 10–15k input tokens and 4–6k output tokens on Sonnet, which comes to a few rupees per job. Set a monthly spend limit in the Anthropic console.

## Privacy

Your resume and last report are saved only in your phone's browser storage. They're sent to the Anthropic API only when you run an analysis.
