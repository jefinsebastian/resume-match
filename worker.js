// Cloudflare Worker entry: serves the app from ./public and handles POST /api/claude.
// Secrets (Worker > Settings > Variables and Secrets): ANTHROPIC_API_KEY, APP_PASSCODE; optional ANTHROPIC_MODEL.
import { onRequestPost, onRequest } from "./functions/api/claude.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/claude") {
      return request.method === "POST" ? onRequestPost({ request, env, ctx }) : onRequest();
    }
    return env.ASSETS.fetch(request);
  },
};
