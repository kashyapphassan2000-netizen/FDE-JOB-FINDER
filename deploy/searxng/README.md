# Unlimited free web search for the AI agent (SearXNG on Hugging Face)

1. Create a free account at https://huggingface.co (no card).
2. New Space → SDK **Docker** → **Private** → name it `fde-search`.
3. Upload `Dockerfile` and `settings.yml` from this folder. In Space Settings → Variables and secrets add secret `SEARXNG_SECRET` = any long random string.
4. Wait for "Running". Your URL is `https://<username>-fde-search.hf.space`.
5. Create an HF access token (Settings → Access Tokens → Read).
6. In the app → AI & Keys: `SEARXNG_URL` = the Space URL, `SEARXNG_TOKEN` = the HF token.

The app's cron keeps the Space awake. SearXNG queries many engines at once, so it also supports `site:x.com` / `site:linkedin.com/posts` searches with no monthly quota.
