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

## Option A — Render.com (free, no card, ~5 minutes)
1. render.com → sign up with GitHub.
2. New + → Web Service → Build and deploy from a Git repository → connect GitHub → choose this repo.
3. Branch: the branch holding this folder · Root Directory: `deploy/searxng` · Runtime: Docker · Instance type: Free.
4. Environment Variables: `SEARXNG_SECRET` = any long random text, `PORT` = `8080`.
5. Create Web Service → wait until Live → test `https://<name>.onrender.com/search?q=test&format=json`.
6. In FDE Job Finder → Unlimited setup: `SEARXNG_URL` = that URL (no token needed).
Free services sleep after 15 min idle; the first search after that takes ~1 min.
(Hugging Face Docker Spaces now require a paid plan.)

## Option B — your own PC (truly unlimited, free)
`docker run -d -p 8080:8080 -v $PWD/settings.yml:/etc/searxng/settings.yml searxng/searxng` → `SEARXNG_URL=http://localhost:8080`
(works for the app running on localhost / the worker; the cloud site cannot reach your PC).

## Option C — any VM (Oracle Cloud Always Free, etc.)
Same docker command on the VM, put it behind HTTPS (Caddy), set `SEARXNG_URL=https://your-domain`.
