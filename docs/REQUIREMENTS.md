# FDE Job Finder — owner's requirements (keep these; every change must respect them)

Collected from the owner's instructions. Brutally honest, no fake claims.

## Who / what
- Owner: Bengaluru-based, moving into AI engineering. **Do not** target automotive/embedded careers (past background) — embedded/semiconductor companies are fine only for FDE / AI-ML roles.
- Target roles: **Forward Deployed Engineer** and **AI / ML** roles (applied AI, AI/LLM/GenAI engineer, ML engineer, MLOps, AI solutions/deployment engineer, founding AI engineer) — in **every company domain**.
- "Search any role" must also work for any other role the owner types.

## Location rule (strict)
- The **only office** the owner can attend is **Bengaluru** (onsite or hybrid).
- Everything else must be **remote and open to people in India**. Drop onsite roles anywhere else and remote roles locked to US/EU/UK/Canada (including when only the title says "USA Remote").
- Relocation boards are outside the rule (shown, marked, not mixed in).

## Coverage
- Cover **everything in the AI Job Search Master Excel** (all 42 sheets, 286 platforms/companies/channels). The Excel coverage map shows the **real, runtime-checked** status of each item — never mark something live unless it is connected and its last run succeeded.
- All companies: watched ATS boards, Workday/Oracle boards, AI reader for custom careers pages, Capture for login-only sites.
- X/Twitter and LinkedIn hiring posts must be searched deeply, with the post text, author, date and how to apply.
- Latest jobs first; fetch jobs posted in the last 24 h; email alerts so no opening is missed.
- Daily email (kashyaphvk963@gmail.com) of ~10 fresh jobs: low competition, high pay, mapped to the CV.

## Features the owner asked for
- AI agent (custom prompts, deep search) + separate tabs per search area (X, LinkedIn, Hidden Bengaluru, Remote India, US/EU remote, Semi & Embedded AI, New startups, Communities).
- Search any role everywhere.
- Trends: who hires where, which domains, which skills, new/rising skills (India, USA, world), new roles, latest news — mapped to the owner's skills and where to apply AI solutions.
- Hiring radar (who will hire FDE/AI-ML in coming months, Bengaluru or remote) and Layoffs (who cuts, why, what next).
- Outreach: find founders/managers/recruiters and their emails; AI-drafted emails from the real CV (never invent facts); follow-ups; referrals.
- Change resume any time; any AI provider (built-in or third party via base URL + key + model).
- Delete logs/finds manually and get fresh results.
- Free first: free tiers + keyless fallbacks; be honest where something is impossible for free.
- Beautiful, simple UI.

## Added later (keep)
- **My dashboard** (default page): everything in one place, FDE recommendations filtered by years of experience; Bengaluru first, then remote (India OK).
- **Jobs**: Bengaluru first, then worldwide remote open to India; experience filter.
- **Agent tabs** (X, LinkedIn posts, Hidden Bengaluru, Remote India, US/EU remote, Semi & Embedded AI, New startups, Communities): each takes a plain-English request scoped to that tab; results shown in the app (no redirects to LinkedIn).
- **Export PDF on every page**, plus one "Export all" button that puts every page into one PDF.
- **Access**: owner adds/removes emails (sign-in link / one-time invite, never the password). Owners = the emails in `OWNER_EMAILS` (Vercel env). Lockdown = only owners. Password can be changed in Settings (signs everyone else out).
- **Fresh data only, everywhere**:
  - Trends report, Hiring radar, Layoffs: news from the last 7 days (Google News + Bing News, dated), full articles read, facts extracted with sources; rebuilt daily by cron and automatically when a page is opened and the data is older than 20 h. Hiring signals older than 45 days and layoffs older than 60 days are purged.
  - Hidden jobs & startups: funding news from the last 30 days; companies re-checked every 3 days, hidden if not re-checked in 14 days; auto-scan when older than 24 h.
  - Opportunities: refreshed every 3 h; closed deadlines and contracts older than 45 days removed.
  - Jobs: removed when not seen on their board for 5 days or posted more than 60 days ago (unless tracked). Agent finds older than 30 days are hidden unless saved/applied.
- **Per-page export = that page only.** On an Agent tab (X, LinkedIn posts, Hidden Bengaluru, …) the PDF/CSV holds only that tab's results; default window = posted in the last 24 h, newest first (selector: 24 h / 3 / 7 / 30 days / any). "Export ALL pages" in the top bar is the only all-in-one export.
- **Companies hiring** sheet: every company worldwide the app tracks, with its careers page and live counts of FDE / AI-ML roles (Bengaluru office or remote-from-India), new in 24 h, latest posting; filters for FDE-only, "hires FDEs", Bengaluru / remote, new startups. New startups (YC hiring + funding news) are found daily and auto-watched when they have a role the owner can take.
- Posts missions run by cron search the last 24 h.
- **Job alerts for others**: owner adds any email + their roles + where they can work; daily the app runs the full search strategy for their roles and emails the best fresh links (never the same job twice). Needs GMAIL_USER + GMAIL_APP_PASSWORD to email anyone.
- **Watch companies**: paste any company name / careers link → its ATS board is polled every refresh, or its careers page is read by the AI reader.
- **Job analyzer & prep**: paste any job (LinkedIn, X, careers page, or text) → role decode, company good/bad + news, interview rounds, round-by-round questions (reported vs likely, with sources and model answers), strategy & mindset, referral route + messages, CV fit, projects, skills, 7-day plan; questions PDF + full report PDF.
- **Recruiters & referrals**: paste a company → recruiters, hiring managers, engineers who can refer (public LinkedIn/web), emails (found or pattern-guessed, labelled), referral ladder and messages from the CV.
- **Watch companies → email alerts**: add one or in bulk (name / careers link / "Name | link | locations"); each is mapped and verified (job board = exact; careers page = AI reader, one hop to the open-positions page; or clearly "not possible"). Per-company locations. Watcher every ~2 h emails only NEW jobs needing AI / FDE people (FDE, AI/ML, or AI-heavy roles) in those locations; first check is a baseline.
- **Every agent tab does ONLY its own job** (strict rules in lib/agent.ts RULES): X tab = only X posts (site:x.com, /status/ links); LinkedIn tab = only LinkedIn posts; Hidden Bengaluru = Bengaluru jobs at startups; Remote India / US-EU = remote jobs only; Semi & Embedded = jobs/companies in that domain; New startups = funded startups + roles; Communities = HN / Reddit / Indie Hackers / newsletters. Off-tab results are never searched, saved, shown or exported on that tab; job-board checks and careers-page reading run only on tabs whose job includes them.
- **Careers search**: every company job board (built-in + yours + watched + discovered startups, ~280 boards) fetched straight from their APIs in one shot (~30 s, cached 2 h, cron 4×/day) plus careers-page roles; ranked by the owner's **priority profile** (ordered roles, ordered locations, experience, exclusions, must-have words). The same profile drives Jobs sorting ("my priorities").
- **Watch by name**: resolver = ATS slug guess → job-board site search (ownership-checked) → official site /careers paths (follows links to the board) → web search; wrong-company risk shown with the mapped link; pasting the careers link always maps exactly.
