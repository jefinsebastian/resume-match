# Resume Match

Score your resume against any job description: ATS check, keyword match, job fit, and a tailored resume you can download as .docx or PDF. Installable on Android and iPhone as an app (PWA).

## How it's built

- `public/`: the app, a single `index.html` plus the manifest, service worker and icons. No build step.
- `functions/api/claude.js`: a Cloudflare Pages Function that calls the Anthropic API. Your API key stays on the server and never reaches the browser.

## Deploy on Cloudflare Pages

1. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git**, then pick this repo.
2. Use these build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `public`
3. Click **Save and Deploy**.
4. Open **Settings → Variables and Secrets** and add these for **Production**:
   - `ANTHROPIC_API_KEY`, type **Secret**: your key from console.anthropic.com
   - `APP_PASSCODE`, type **Secret**: any passcode. The app asks for it once on each device, so nobody else can spend your API credit.
   - `ANTHROPIC_MODEL` (optional): defaults to `claude-sonnet-5-5`
5. Open **Deployments → … → Retry deployment** so the new variables take effect.
6. Optional custom domain: go to **Custom domains → Set up a domain** and add something like `resume.jefinsebastian.com`. Your DNS is already on Cloudflare, so it's one click.

## Install on your phone

- **Android (Chrome):** open the site, then tap **⋮ → Add to Home screen → Install**.
- **iPhone (Safari):** open the site, then tap **Share → Add to Home Screen**.

## Cost

You pay Anthropic per use. One score plus one tailored resume is roughly 10–15k input tokens and 4–6k output tokens on Sonnet, which comes to a few rupees per job. Set a monthly spend limit in the Anthropic console.

## Privacy

Your resume and last report are saved only in your phone's browser storage. They're sent to the Anthropic API only when you run an analysis.
