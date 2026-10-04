# FDE Job Finder

Private, owner-only job portal for **Forward Deployed Engineer (FDE)** and **AI/ML** roles — in **every company domain** (semiconductor, embedded/robotics/automotive, IT/SaaS, fintech, health, defense, frontier labs) — across Bengaluru, India, USA and remote-open-to-India. Near-real-time from LinkedIn, X, ~190 company career boards and job aggregators, plus an **AI agent** (Google / LinkedIn posts / X posts / company websites), a **hidden-jobs & new-startups scanner**, every platform from the *AI Job Search Master Excel*, an application tracker, and your CV (private, versioned). Bring any AI: Claude, OpenAI, Gemini, Groq, OpenRouter or any third-party OpenAI/Anthropic-compatible endpoint.

> **Deploy guide:** `docs/FDE_Job_Finder_Setup_Guide.pdf` — step-by-step: Vercel, storage, every API key, GitHub Action, Telegram alerts.

## What it does

| Area | Details |
|---|---|
| **Live job sources (no key)** | Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday (NVIDIA, Intel, Micron, NXP, ADI, Samsung, Marvell, Cadence, KLA…), Amazon, Microsoft, LinkedIn (public guest search), Y Combinator jobs, Instahyre, Hacker News "Who's hiring", Reddit, Telegram channels, Remotive, Remote OK, Himalayas, Jobicy, The Muse, Working Nomads, We Work Remotely, Jobspresso |
| **Live sources (API key)** | JSearch (LinkedIn/Indeed/Glassdoor/Naukri via Google for Jobs), SerpApi Google Jobs (Naukri, Foundit, Shine, iimjobs, Hirist, Cutshort, Wellfound…), Adzuna, Jooble, Apify LinkedIn, X official API, twitterapi.io |
| **~180 companies watched directly** | Frontier labs, FDE-heavy startups, AI infra, AI silicon & semiconductor, robotics/autonomy/defense, Indian AI startups. Add any company in Settings (auto-detects its ATS). |
| **Role rule** | Only FDE + AI/ML roles are kept; company domain (semiconductor, embedded, IT…) is a tag/filter, not a restriction |
| **Personal portal** | Filters: role, where (Bengaluru / India / USA / remote India-eligible), domain, level, source, freshness, hidden gems, salary · Apply button · AI fit check (score, gaps, pitch, cold DM, cover note) |
| **AI Agent** | Free-text or preset missions; plans queries → multi-engine web search (Tavily/Firecrawl/Exa/Linkup/Serper/Brave/Jina/SerpApi/SearXNG, rotated) → verifies company ATS boards live → AI filters & reads career pages → Finds tab; auto every 3 h |
| **Hidden jobs & startups** | YC hiring companies + freshly funded startups (ET Tech, Inc42, YourStory, TechCrunch, Crunchbase News) → careers board detection → open FDE/AI roles → one-click Watch; daily |
| **Bring your own AI** | Ordered fallback chain of providers (free tiers stack); keys AES-encrypted in Redis; any third party via base URL + model + key |
| **Excel sheets tab** | All 42 sheets, every cell word-for-word (7,178 cells) with per-row To-do / Doing / Done / Skip + notes, progress per sheet, global search |
| **Platforms map** | All 286 platforms named in the Excel, each mapped to how it's tracked (live API, live ATS, via aggregator, 1-click search, resource) with "last checked" tracking |
| **Tracker** | Saved → Applied → Referral → Interview → Offer / Rejected, notes, CSV export |
| **CV** | Upload/update PDF/DOCX to a **private** Vercel Blob store, version history, skills auto-extracted for CV-match scoring |
| **Daily email** | Every morning (~08:00 IST): top 10 jobs posted in the last 24 h, ranked by CV fit (AI-checked against your CV text when an AI key is set) 40%, pay 30%, low competition 30%; never repeats a job. Resend (free). Preview / Send now in Settings |
| **Alerts** | Telegram (and/or Discord/Slack webhook) for new high-score jobs |
| **Refresh** | Manual button, GitHub Action every 30 min, Vercel Cron daily backup |
| **Security** | Single password (APP_PASSWORD), HMAC-signed httpOnly cookie, every API route re-checks auth, cron protected by CRON_SECRET, noindex headers |

## Stack
Next.js 16 (App Router) · TypeScript · Upstash Redis (Vercel Marketplace) · Vercel Blob (private) · no UI framework.

## Local dev
```bash
npm install
cp .env.example .env.local   # set APP_PASSWORD, AUTH_SECRET, CRON_SECRET at minimum
npm run dev                  # http://localhost:3000
```
Without Redis env vars the app runs in memory mode (data resets on restart).

## Updating the Excel
Replace `data/source_workbook.xlsx` and run `npm run excel` (needs Python + `pip install openpyxl`), then commit & push — Vercel redeploys automatically. Row tracking is keyed by `sheet:row`, so keep row order stable if you want existing ticks to stay aligned.

## Honest limits
- **LinkedIn** has no public jobs API. The free guest endpoint works from most IPs but LinkedIn may rate-limit Vercel's IPs — JSearch / Apify are the reliable fallbacks.
- **X** no longer has a free read API for new developers; use pay-per-use credits or twitterapi.io.
- **Naukri, Wellfound, Cutshort, Hirist, Foundit** have no public APIs and block scrapers; their postings arrive via Google-Jobs aggregators (SerpApi/JSearch) and are one-click searchable from the Platforms tab.
- **Vercel Hobby** cron = once/day → the included GitHub Action gives 30-minute refreshes for free.
