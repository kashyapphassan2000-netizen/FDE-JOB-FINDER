---
title: fde-search
emoji: 🔎
colorFrom: green
colorTo: gray
sdk: docker
app_port: 8080
pinned: false
---

# Your own unlimited search engine (SearXNG) for FDE Job Finder

No per-search quota: it searches Google, Bing, DuckDuckGo, Brave, Startpage, Mojeek and Qwant for you and
returns JSON. Honest limit: each upstream engine may slow down very heavy use from one server IP, which is why
it spreads queries across seven engines.

## Option A — Hugging Face Space (free, 5 minutes, no card)
1. huggingface.co → sign up → New Space → name `fde-search` → SDK **Docker** → Blank → visibility **Private** → Create.
2. Upload the three files from this folder (`Dockerfile`, `settings.yml`, `README.md`) → it builds (~3 min).
3. Space → Settings → Variables and secrets → New secret `SEARXNG_SECRET` = any long random text → restart.
4. Your URL is `https://<your-hf-username>-fde-search.hf.space`. Test: open `…/search?q=test&format=json`.
5. In FDE Job Finder → AI & Keys (or Unlimited setup): `SEARXNG_URL` = that URL; because the Space is private,
   also `SEARXNG_TOKEN` = a Hugging Face **read** token (huggingface.co/settings/tokens).

## Option B — your own PC (truly unlimited, free)
`docker run -d -p 8080:8080 -v $PWD/settings.yml:/etc/searxng/settings.yml searxng/searxng` → `SEARXNG_URL=http://localhost:8080`
(works for the app running on localhost / the worker; the cloud site cannot reach your PC).

## Option C — any VM (Oracle Cloud Always Free, etc.)
Same docker command on the VM, put it behind HTTPS (Caddy), set `SEARXNG_URL=https://your-domain`.
