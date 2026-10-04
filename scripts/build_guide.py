"""Generates docs/FDE_Job_Finder_Setup_Guide.pdf  (python3 scripts/build_guide.py)"""
import json, html
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, Preformatted)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

F = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('DV', F + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', F + 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DVO', F + 'DejaVuSans-Oblique.ttf'))
pdfmetrics.registerFont(TTFont('DVM', F + 'DejaVuSansMono.ttf'))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('DV', normal='DV', bold='DVB', italic='DVO', boldItalic='DVB')

INK = colors.HexColor('#111418'); MUTED = colors.HexColor('#5d6673'); ACC = colors.HexColor('#15803d')
SOFT = colors.HexColor('#eef7f0'); LINE = colors.HexColor('#d8dde3'); WARN = colors.HexColor('#fff4dc'); ERR = colors.HexColor('#fde8e8')

ss = getSampleStyleSheet()
S = {
    'title': ParagraphStyle('t', fontName='DVB', fontSize=24, leading=29, textColor=INK, spaceAfter=6),
    'sub': ParagraphStyle('s', fontName='DV', fontSize=11.5, leading=16, textColor=MUTED, spaceAfter=14),
    'h1': ParagraphStyle('h1', fontName='DVB', fontSize=16, leading=20, textColor=INK, spaceBefore=10, spaceAfter=8),
    'h2': ParagraphStyle('h2', fontName='DVB', fontSize=12.5, leading=16, textColor=ACC, spaceBefore=8, spaceAfter=5),
    'p': ParagraphStyle('p', fontName='DV', fontSize=9.6, leading=13.6, textColor=INK, spaceAfter=5),
    'li': ParagraphStyle('li', fontName='DV', fontSize=9.6, leading=13.6, textColor=INK, leftIndent=14, bulletIndent=4, spaceAfter=2.5),
    'cell': ParagraphStyle('c', fontName='DV', fontSize=8.2, leading=10.6, textColor=INK),
    'cellb': ParagraphStyle('cb', fontName='DVB', fontSize=8.2, leading=10.6, textColor=INK),
    'tiny': ParagraphStyle('tiny', fontName='DV', fontSize=7.3, leading=9.2, textColor=INK),
    'code': ParagraphStyle('code', fontName='DVM', fontSize=8.2, leading=10.8, textColor=INK, backColor=colors.HexColor('#f3f4f6'), borderPadding=5, leftIndent=4, rightIndent=4, spaceBefore=3, spaceAfter=7),
}

def P(t, st='p'): return Paragraph(t, S[st])
def B(items): return [Paragraph(i, S['li'], bulletText='•') for i in items]
def N(items): return [Paragraph(i, S['li'], bulletText=f'{n}.') for n, i in enumerate(items, 1)]
def code(t): return Preformatted(t, S['code'])
def box(text, bg=SOFT, border=ACC):
    t = Table([[Paragraph(text, S['p'])]], colWidths=[174 * mm])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), bg), ('BOX', (0, 0), (-1, -1), 0.8, border),
                           ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    return t
def table(rows, widths, head=True, style='cell'):
    data = [[c if not isinstance(c, str) else Paragraph(c, S['cellb' if (head and i == 0) else style]) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if head else 0)
    st = [('GRID', (0, 0), (-1, -1), 0.4, LINE), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
          ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4), ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3)]
    if head: st.append(('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8f3ec')))
    t.setStyle(TableStyle(st))
    return t
def e(s): return html.escape(s)

story = []
# ---------------- COVER ----------------
story += [Spacer(1, 30 * mm), P('FDE Job Finder', 'title'),
          P('Setup, API &amp; Deploy Guide v2 — personal job portal + AI agent, every API mapped, hosted on Vercel', 'sub'),
          P('Your private job portal for <b>Forward Deployed Engineer</b> and <b>AI/ML</b> roles — in <b>every company domain</b> (semiconductor, embedded/robotics/automotive, IT/SaaS, fintech, health, defense, frontier labs) — across Bengaluru, India, USA and remote-open-to-India. Sources: LinkedIn, X, ~190 company career boards, job aggregators, an <b>AI agent</b> that searches Google / LinkedIn posts / X posts / company websites, a <b>hidden-jobs scanner</b> for new startups, and all 286 platforms from your <i>AI Job Search Master Excel</i>. Bring any AI (Claude, OpenAI, Gemini, Groq, OpenRouter or any third party). Only you can log in; your CV lives in a private store.'),
          Spacer(1, 6),
          box('<b>How to use this PDF:</b> do Part A in order (≈30–40 min, all free). After Part A the app is live with 23 keyless sources already pulling jobs. Part B adds paid/quota APIs one by one — each is optional and each makes coverage better. Part C is reference: every source, every platform from the Excel, troubleshooting, costs.'),
          Spacer(1, 8),
          box('<b>Brutal truths up front</b><br/>'
              '1. <b>LinkedIn has no public jobs API.</b> The app uses LinkedIn\'s public guest search (free, worked in testing) but LinkedIn can rate-limit Vercel\'s servers. Reliable LinkedIn = JSearch (free tier) or Apify (paid per result).<br/>'
              '2. <b>X (Twitter) has no free read API</b> for new developers anymore. Official API is pay-per-use (~$0.005 per post read); twitterapi.io is ~30× cheaper.<br/>'
              '3. <b>Naukri, Wellfound, Cutshort, Hirist, Foundit, iimjobs, Shine have no public API</b> and block bots. Their jobs reach you through Google-Jobs aggregators (SerpApi / JSearch) plus one-click pre-filled searches in the Platforms tab.<br/>'
              '4. <b>Vercel free (Hobby) cron runs only once a day.</b> The included GitHub Action refreshes every 30 minutes for free — that is your "real-time".<br/>'
              '5. <b>No AI is truly “free and unlimited”.</b> Free tiers are rate-limited (Groq ≈1,000 requests/day/model, OpenRouter free 50/day, Gemini free limits shown in AI Studio). The app chains providers — when one hits its limit the next answers — which is as close to unlimited-free as it gets. Web search for the agent works the same way (Tavily 1,000/mo + Firecrawl + Exa + Linkup + Serper, or your own SearXNG = unlimited).<br/>'
              '6. FDE hiring at frontier labs is mostly passive sourcing. This tool finds roles within ~30 min of posting; the Excel tracker + referrals is what converts them.', WARN, colors.HexColor('#b45309')),
          PageBreak()]

# ---------------- ARCHITECTURE ----------------
story += [P('0. What you are deploying', 'h1'),
          table([['Piece', 'What it is', 'Cost'],
                 ['Next.js app on Vercel', 'Tabs: Jobs · AI Agent · Hidden jobs &amp; startups · Tracker · Excel sheets · Platforms map · Sources &amp; APIs · AI &amp; Keys · CV · Settings', 'Free (Hobby)'],
                 ['AI provider(s)', 'Any model: Gemini / Groq / OpenRouter (free tiers), Claude, OpenAI, or any third-party OpenAI/Anthropic-compatible endpoint. Used for agent filtering, reading career pages, fit checks, cover notes', '$0 (free tiers) → your choice'],
                 ['Web search (agent)', 'Tavily / Firecrawl / Exa / Linkup / Serper / Brave / Jina / SerpApi / your SearXNG — rotated so free tiers stack', '$0 (free tiers)'],
                 ['Upstash Redis', 'Stores jobs, your tracker, Excel ticks, settings, source health (gzip-compressed)', 'Free (500K commands, 256 MB)'],
                 ['Vercel Blob (Private)', 'Your CV files + every older version. No public URL — served only to your logged-in session', 'Free (1 GB)'],
                 ['GitHub Action', 'Every 30 min: refresh jobs · every 3 h: AI-agent mission · daily: hidden-jobs scan', 'Free'],
                 ['Vercel Cron', 'Daily backup refresh (Hobby limit)', 'Free'],
                 ['Telegram bot (optional)', 'Pushes new high-score jobs to your phone', 'Free'],
                 ['Job APIs', '23 keyless sources built in; 7 optional keyed sources (Part B)', '$0 → ~$15/mo (your choice)']],
                [42, 100, 32]),
          Spacer(1, 6),
          P('<b>Data flow:</b> trigger (button / GitHub Action / Vercel Cron) → <font face="DVM">/api/cron</font> → every source runs in parallel with a 90 s timeout each → jobs are filtered (<b>role must be FDE or AI/ML</b> — any company domain; excluded words removed) → tagged with domain (semiconductor, embedded, IT…) and region (Bengaluru, India, USA, remote-India-eligible) → de-duplicated across sources → scored (role + Bengaluru/India/Remote + freshness + CV match) → saved to Redis → Telegram alert for new jobs above your score threshold. One broken source never breaks the others; its error shows in <b>Sources &amp; APIs</b>.'),
          P('<b>Tested before hand-over (4 Oct 2026):</b> all 23 keyless sources were run live from an internet-connected sandbox — every one returned data (≈2,850 FDE + AI/ML jobs after de-duplication in one pass: 250 Bengaluru, 400 India, 1,440 USA, 740 remote; the hidden-jobs scanner found 683 hiring YC AI companies + freshly funded startups and verified their career boards in seconds, e.g. Anthropic "Applied AI Architect — Bangalore", DevRev "Forward Deployed Engineer — Bengaluru", Instahyre FDE roles, NVIDIA / Samsung Workday roles). The production build, login, tracker, Excel tracking, platform tracking, settings and CSV export were tested end-to-end. Keyed APIs (Part B) were coded against their official docs but could not be called without your keys — use the <b>Run now</b> button per source after adding a key.'),
          PageBreak()]

# ---------------- PART A ----------------
story += [P('PART A — Go live (free, ~30–40 min)', 'h1'),
          P('A1. Get the code into your GitHub repo', 'h2'),
          P('Repo: <font face="DVM">github.com/kashyapphassan2000-netizen/FDE-JOB-FINDER</font>. If the code is already there (Claude pushed it), skip to A2. Otherwise unzip <font face="DVM">fde-job-finder.zip</font> and run in that folder:'),
          code('git init\ngit add .\ngit commit -m "FDE Job Finder"\ngit branch -M main\ngit remote add origin https://github.com/kashyapphassan2000-netizen/FDE-JOB-FINDER.git\ngit push -u origin main      # add --force only if the repo has an old README you want replaced'),
          box('Make the repo <b>Private</b> (GitHub → repo → Settings → General → Danger Zone → Change visibility) if you prefer. Nothing secret is in the code — all keys live in Vercel env vars — but private is cleaner. GitHub Actions still work on private repos (2,000 free minutes/month; this job uses ~1 min per run ≈ 1,440 min/month — inside the free quota but close. If you want margin, change the schedule to every 45 min in <font face="DVM">.github/workflows/refresh.yml</font>, or keep the repo public: Actions minutes are unlimited for public repos).', WARN, colors.HexColor('#b45309')),
          P('A2. Import into Vercel', 'h2')]
story += N(['Go to <b>vercel.com</b> → log in with your account (only you have it — keep 2FA on: Account Settings → Authentication).',
            '<b>Add New… → Project</b> → <b>Import Git Repository</b> → pick <font face="DVM">FDE-JOB-FINDER</font> (authorise the Vercel GitHub app for that repo if asked).',
            'Framework preset: <b>Next.js</b> (auto-detected). Root directory: <font face="DVM">./</font>. Build command / output: leave defaults.',
            'Before clicking Deploy, open <b>Environment Variables</b> and add the three required ones from A3. Then click <b>Deploy</b>.'])
story += [P('A3. Required environment variables', 'h2'),
          table([['Name', 'Value', 'Why'],
                 ['APP_PASSWORD', 'A strong password only you know', 'Login to the dashboard'],
                 ['AUTH_SECRET', '64 random hex chars', 'Signs your session cookie (rotate it to log out every device)'],
                 ['CRON_SECRET', '64 random hex chars (different)', 'Protects /api/cron; Vercel Cron + GitHub Action send it']],
                [34, 62, 78]),
          P('Generate random secrets (any one of these):'),
          code('# Windows PowerShell\n-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})\n# Git Bash / Linux / macOS\nopenssl rand -hex 32\n# or: https://generate-secret.vercel.app/32'),
          P('A4. Storage — Redis (tracker &amp; jobs) and Blob (CV)', 'h2')]
story += N(['Vercel → your project → <b>Storage</b> tab → <b>Create Database</b> / <b>Browse Marketplace</b> → choose <b>Upstash</b> → <b>Upstash for Redis</b> → plan <b>Free</b> → region closest to you (e.g. <i>ap-south-1 Mumbai</i>) → <b>Connect</b> to this project (all environments). This injects <font face="DVM">KV_REST_API_URL</font> and <font face="DVM">KV_REST_API_TOKEN</font> automatically.',
            'Storage tab again → <b>Create</b> → <b>Blob</b> → set access to <b>Private</b> (important — public would expose your CV) → <b>Connect</b> to this project. Vercel adds the store ID / token automatically.',
            '<b>Deployments</b> tab → on the latest deployment click <b>⋯ → Redeploy</b> (env vars only apply to new deployments).'])
story += [P('A5. First login &amp; first refresh', 'h2')]
story += N(['Open <font face="DVM">https://&lt;your-project&gt;.vercel.app</font> → you are redirected to <b>/login</b> → enter APP_PASSWORD.',
            'Click <b>⟳ Refresh now</b>. First run takes 30–60 s. You should see a few thousand relevant jobs.',
            'Open <b>Sources &amp; APIs</b>: the top checklist must be all green except the optional alerts. Each source shows OK / partial / error with the exact error text.',
            'If the yellow "memory mode" banner shows, Redis is not connected → repeat A4 step 1 and redeploy.'])
story += [P('A6. Live automation with GitHub Actions (free): refresh every 30 min, agent every 3 h, hidden-jobs scan daily', 'h2')]
story += N(['GitHub → your repo → <b>Settings → Secrets and variables → Actions → New repository secret</b>.',
            'Add <font face="DVM">APP_URL</font> = <font face="DVM">https://&lt;your-project&gt;.vercel.app</font> (no trailing slash).',
            'Add <font face="DVM">CRON_SECRET</font> = exactly the same value as on Vercel.',
            '<b>Actions</b> tab → enable workflows if asked → open <b>refresh-jobs</b> → <b>Run workflow</b> to test. A green tick and JSON with <font face="DVM">"ok":true</font> means it works. From now on it refreshes every 30 min, runs one AI-agent mission every 3 h and scans hidden jobs daily (the agent/scan continue on Vercel in the background, so they cost GitHub ~10 seconds each). GitHub may delay schedules by a few minutes under load. In the Run workflow box you can also type <font face="DVM">agent</font> or <font face="DVM">discover</font> to trigger those by hand.'])
story += [box('Vercel Cron (in <font face="DVM">vercel.json</font>) also runs once a day at 02:30 UTC as a backup — Hobby plans can\'t run cron more often. If you ever move to Vercel Pro you can change it to <font face="DVM">*/15 * * * *</font> and drop the GitHub Action.'),
          P('A7. Upload your CV', 'h2'),
          P('<b>CV</b> tab → choose your PDF/DOCX (max 4 MB) → optional extra skills → <b>Upload CV</b>. Skills are extracted automatically (Python, PyTorch, LangGraph, RAG, vLLM, QLoRA, Kubernetes, AUTOSAR, CAN, dSPACE…) and every job gets a CV-match % on the next refresh. To update your CV just upload the new file — older versions stay listed; you can switch the active one, download or delete any version. Files are in a private Blob store and are only streamed through <font face="DVM">/api/cv/download</font> after the login check.'),
          P('A8. Lock-down checklist', 'h2')]
story += B(['Vercel account: 2FA on; don\'t add team members to this project.',
            'The whole app (pages + APIs) requires your password; only <font face="DVM">/login</font>, <font face="DVM">/api/health</font> (returns just "ok") and <font face="DVM">/api/cron</font> (needs CRON_SECRET) are reachable without it. Pages send <font face="DVM">noindex</font> so search engines skip them.',
            'Optional extra wall: Vercel → Project → Settings → <b>Deployment Protection</b>. On Hobby, "Standard Protection" covers preview URLs; production stays protected by your password.',
            'Never paste API keys into the code or the repo — only into Vercel → Settings → Environment Variables.'])
story += [P('A9. Plug in a FREE AI provider (2 min) — or any model you like', 'h2')]
story += N(['Open <font face="DVM">aistudio.google.com/apikey</font> → <b>Create API key</b> (Google account, no card).',
            'App → <b>AI &amp; Keys</b> tab → Provider: <b>Google Gemini</b> → paste the key → leave Model empty (auto-picks a Flash model) or click <b>Load models</b> → <b>Save provider</b> → <b>Test</b>.',
            'Add a second free provider as backup: <b>Groq</b> (<font face="DVM">console.groq.com/keys</font>) and/or <b>OpenRouter</b> (<font face="DVM">openrouter.ai/keys</font>, pick a model ending in <font face="DVM">:free</font>). Use ↑ ↓ to set the order — the first one answers, the next ones take over when it is rate-limited.',
            '<b>Any third party</b>: choose “Any third party (OpenAI-compatible)” or “(Anthropic-compatible)”, type who provides it, its base URL (e.g. <font face="DVM">https://api.provider.com/v1</font>), model and key. Claude: preset “Anthropic Claude”. OpenAI: preset “OpenAI”.'])
story += [box('Keys typed in the app are AES-256-GCM encrypted with your AUTH_SECRET before they are stored, and are never sent back to the browser (only “…last4”). If you change AUTH_SECRET later, re-enter them. Prefer env vars? Set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY or LLM_PROVIDER + LLM_BASE_URL + LLM_API_KEY + LLM_MODEL in Vercel instead.'),
          P('A10. Give the AI agent a free web-search key (2 min)', 'h2')]
story += N(['Sign up at <font face="DVM">app.tavily.com</font> (1,000 searches/month free, no card) → copy the API key.',
            'App → <b>AI &amp; Keys</b> → <b>API keys vault</b> → <b>Web search</b> → paste into <font face="DVM">TAVILY_API_KEY</font> → Save. No redeploy needed.',
            'Optional extra free quota (the agent rotates engines): Firecrawl, Exa, Linkup, Serper (see table B9). Unlimited: host SearXNG and paste its URL into <font face="DVM">SEARXNG_URL</font>.',
            '<b>AI Agent</b> tab → click <b>Run</b> on “LinkedIn hiring posts” — results appear under <b>Finds</b> with Apply / Save / Applied / AI-fit buttons.'])
story.append(PageBreak())

# ---------------- PART B ----------------
story += [P('PART B — Add API keys (optional, one at a time)', 'h1'),
          P('For every key, EITHER paste it in the app → <b>AI &amp; Keys → API keys vault</b> (instant, encrypted, no redeploy) OR add it in Vercel → <b>Settings → Environment Variables</b> and <b>Redeploy</b>. Then app → <b>Sources &amp; APIs</b> → <b>Run now</b> on that source → it should turn green. Quota-limited sources respect a cooldown (shown in the table) so the 30-min refresh never burns your free tier; override with <font face="DVM">&lt;ID&gt;_INTERVAL_MIN</font>.'),
          table([['Priority / source', 'Covers', 'Free tier / price', 'Env var(s)', 'Default cadence'],
                 ['<b>1. JSearch</b> (RapidAPI)', 'LinkedIn, Indeed, Glassdoor, ZipRecruiter, Naukri &amp; company sites via Google for Jobs', 'Free Basic plan (small monthly quota, hard-capped — no surprise bills). Paid plans if you want more.', 'RAPIDAPI_KEY', '3 queries every 12 h ≈ 180/mo'],
                 ['<b>2. SerpApi</b> Google Jobs', 'Naukri, Foundit, Shine, iimjobs, Hirist, Cutshort, Instahyre, Wellfound, Glassdoor (shown as "via …")', '250 searches/month free, no card', 'SERPAPI_KEY', '4 queries every 12 h ≈ 240/mo'],
                 ['<b>3. Adzuna</b>', 'Adzuna India index', 'Free developer key', 'ADZUNA_APP_ID, ADZUNA_APP_KEY', '4 queries every 2 h'],
                 ['<b>4. Jooble</b>', 'Jooble India index (Naukri, Indeed, smaller boards)', 'Free key on request', 'JOOBLE_API_KEY', '4 queries every 2 h'],
                 ['<b>5. twitterapi.io</b>', 'X hiring tweets (FDE / AI / India)', '~$0.15 per 1,000 tweets; free starter credits', 'TWITTERAPI_IO_KEY', '2 queries every 2 h'],
                 ['<b>6. X official API</b>', 'Same as above, official', 'Pay-per-use credits (~$0.005/post read). No free tier for new devs.', 'X_BEARER_TOKEN', '2×10 tweets every 12 h ≈ $3/mo'],
                 ['<b>7. Apify</b> LinkedIn scraper', 'Reliable LinkedIn jobs with full details', '$5 free credit/month; ~$0.002 per job', 'APIFY_TOKEN', '4 searches × 25 jobs every 12 h ≈ $6/mo'],
                 ['The Muse (optional key)', 'Raises The Muse rate limit', 'Free', 'THEMUSE_API_KEY', 'every 2 h']],
                [30, 46, 42, 30, 26]),
          Spacer(1, 6),
          P('B1. JSearch (RapidAPI) — best single key for LinkedIn/Indeed/Glassdoor', 'h2')]
story += N(['Open <font face="DVM">rapidapi.com</font> → Sign up (Google login is fine).',
            'Search <b>JSearch</b> (publisher: letscrape / OpenWeb Ninja) → <b>Pricing</b> → subscribe to <b>Basic (free)</b>.',
            'Go to the <b>Endpoints</b> tab → copy <font face="DVM">X-RapidAPI-Key</font> from the code snippet header.',
            'Vercel env var <font face="DVM">RAPIDAPI_KEY</font> = that key → Redeploy → Sources &amp; APIs → JSearch → Run now.'])
story += [P('B2. SerpApi — Google Jobs (Naukri, Foundit, Shine, iimjobs, Hirist, Cutshort, Wellfound…)', 'h2')]
story += N(['<font face="DVM">serpapi.com</font> → Register (free plan, no card) → verify email &amp; phone.',
            'Dashboard → <b>Api Key</b> → copy.',
            'Env var <font face="DVM">SERPAPI_KEY</font> → Redeploy → Run now. Each job shows <i>via Naukri.com</i> / <i>via LinkedIn</i> etc. in the Source column.'])
story += [P('B3. Adzuna', 'h2')]
story += N(['<font face="DVM">developer.adzuna.com</font> → <b>Register</b> → confirm email → log in → <b>Dashboard / API Access Details</b>.',
            'Copy <b>Application ID</b> → <font face="DVM">ADZUNA_APP_ID</font> and <b>Application Key</b> → <font face="DVM">ADZUNA_APP_KEY</font>. The app queries the India endpoint (<font face="DVM">/jobs/in/search</font>).'])
story += [P('B4. Jooble', 'h2')]
story += N(['<font face="DVM">jooble.org/api/about</font> → fill the API access form (name, email, website: your Vercel URL, purpose: personal job alerts).',
            'The key arrives by email (usually within a day) → <font face="DVM">JOOBLE_API_KEY</font>.'])
story += [P('B5. X / Twitter — pick ONE: twitterapi.io (cheap) or the official API', 'h2'),
          P('<b>twitterapi.io:</b> <font face="DVM">twitterapi.io</font> → Sign in with Google → Dashboard → copy API key → <font face="DVM">TWITTERAPI_IO_KEY</font>. Top up only when the starter credits run out.'),
          P('<b>Official X API:</b> <font face="DVM">developer.x.com</font> → sign in with your X account → Developer Console → create a Project + App → <b>Keys and tokens</b> → generate <b>Bearer Token</b> → buy pay-per-use credits (set a spending cap) → <font face="DVM">X_BEARER_TOKEN</font>. Keep <font face="DVM">X_MAX_RESULTS=10</font> to control cost.'),
          P('Search used: <font face="DVM">("forward deployed" OR FDE) hiring</font> and <font face="DVM">("AI engineer" OR "ML engineer" OR "applied AI" OR "embedded AI") hiring (Bangalore OR Bengaluru OR India OR remote)</font>. Tweets appear as jobs with company = @handle.'),
          P('B6. Apify LinkedIn (only if the free LinkedIn source shows rate-limit errors)', 'h2')]
story += N(['<font face="DVM">apify.com</font> → Sign up (free plan includes $5 monthly credit).',
            'Console → <b>Settings → API &amp; Integrations</b> → copy <b>Personal API token</b> → <font face="DVM">APIFY_TOKEN</font>.',
            'Optional: open the actor <font face="DVM">curious_coder/linkedin-jobs-scraper</font> once and click "Try for free" to accept its terms. The app starts a run every 12 h and reads the previous run\'s results instantly (no timeouts). Tune with <font face="DVM">APIFY_LINKEDIN_LIMIT</font> (default 25 jobs per search).'])
story += [P('B7. Telegram alerts to your phone (free)', 'h2')]
story += N(['In Telegram open <b>@BotFather</b> → <font face="DVM">/newbot</font> → name it → copy the token → <font face="DVM">TELEGRAM_BOT_TOKEN</font>.',
            'Open your new bot and send it any message (e.g. "hi").',
            'In a browser open <font face="DVM">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</font> → find <font face="DVM">"chat":{"id": 123456789</font> → that number is <font face="DVM">TELEGRAM_CHAT_ID</font>.',
            'Redeploy → Settings tab → <b>Send test alert</b>. Alerts fire for new jobs with score ≥ the threshold you set (default 60 ≈ FDE in Bengaluru/India, or strong AI role posted &lt; 24 h).',
            'Optional: a Discord/Slack incoming-webhook URL in <font face="DVM">ALERT_WEBHOOK_URL</font> sends the same alerts there.'])
story += [P('B8. AI providers you can plug in (any mix, tried in order)', 'h2'),
          table([['Provider', 'Free?', 'Where to get the key', 'Base URL (auto-filled)', 'Format'],
                 ['Google Gemini', 'Free tier on Flash models', 'aistudio.google.com/apikey', 'generativelanguage.googleapis.com/v1beta/openai', 'OpenAI'],
                 ['Groq', 'Free ~1,000 req/day/model', 'console.groq.com/keys', 'api.groq.com/openai/v1', 'OpenAI'],
                 ['OpenRouter (300+ models)', 'Free “:free” models (50/day; 1,000/day after $10 top-up)', 'openrouter.ai/keys', 'openrouter.ai/api/v1', 'OpenAI'],
                 ['Cerebras', 'Trial credits', 'cloud.cerebras.ai', 'api.cerebras.ai/v1', 'OpenAI'],
                 ['Mistral', 'Free plan monthly credits', 'console.mistral.ai/api-keys', 'api.mistral.ai/v1', 'OpenAI'],
                 ['NVIDIA NIM', 'Free for testing (~40 req/min)', 'build.nvidia.com', 'integrate.api.nvidia.com/v1', 'OpenAI'],
                 ['Anthropic Claude', 'Paid', 'console.anthropic.com', 'api.anthropic.com', 'Anthropic'],
                 ['OpenAI', 'Paid', 'platform.openai.com/api-keys', 'api.openai.com/v1', 'OpenAI'],
                 ['DeepSeek / Together / xAI', 'Paid (cheap)', 'their consoles', 'auto-filled', 'OpenAI'],
                 ['Any third party / proxy / self-hosted', 'Whatever they give', 'their dashboard', 'type it', 'OpenAI or Anthropic']],
                [34, 38, 36, 46, 20]),
          P('B9. Web-search engines for the AI agent (at least one)', 'h2'),
          table([['Engine', 'Free tier', 'Get key', 'Vault / env name'],
                 ['Tavily', '1,000 searches / month, no card', 'app.tavily.com', 'TAVILY_API_KEY'],
                 ['Firecrawl', 'Free monthly credits', 'firecrawl.dev/app/api-keys', 'FIRECRAWL_API_KEY'],
                 ['Exa', 'Free monthly credits', 'dashboard.exa.ai/api-keys', 'EXA_API_KEY'],
                 ['Linkup', 'Free monthly credits', 'app.linkup.so', 'LINKUP_API_KEY'],
                 ['Serper (Google)', '2,500 free (one-time)', 'serper.dev/api-key', 'SERPER_API_KEY'],
                 ['Brave', '$5 monthly credit (card needed)', 'api-dashboard.search.brave.com', 'BRAVE_API_KEY'],
                 ['Jina', 'Free tokens; also speeds up page reading', 'jina.ai/api-dashboard', 'JINA_API_KEY'],
                 ['SerpApi (Google)', 'Shares the 250/mo with Google Jobs', 'serpapi.com', 'SERPAPI_KEY'],
                 ['SearXNG (self-hosted)', 'Unlimited', 'docs.searxng.org (Docker / free VPS)', 'SEARXNG_URL']],
                [32, 52, 50, 40]),
          P('Google\'s own Custom Search JSON API is being shut down (Jan 2027), so it is intentionally not used.', 'p')]
story.append(PageBreak())

# ---------------- PART C: SOURCES ----------------
SOURCES = [
 ('greenhouse', 'No', '~60 company boards (Anthropic, Scale AI, Databricks, Glean, Tenstorrent, Lightmatter, Anduril, Waymo, Samsara, Netradyne, DevRev, Groww…)', 'every run'),
 ('lever', 'No', 'Palantir, Shield AI, Zoox, Mindtickle, CRED, Meesho, Toptal, Eliyan, Field AI…', 'every run'),
 ('ashby', 'No', 'OpenAI, Cohere, Snowflake, Sierra, Decagon, Harvey, Perplexity, ElevenLabs, Cursor, Cognition, Cerebras, Etched, d-Matrix, Sarvam AI, Applied Intuition, Skydio, Wayve, 1X…', 'every run'),
 ('workable', 'No', 'Hugging Face', 'every run'),
 ('smartrecruiters', 'No', 'Bosch, Continental, ServiceNow, Freshworks, Western Digital (5 keyword queries each)', 'every run'),
 ('workday', 'No', 'NVIDIA, Intel, Micron, Marvell, Analog Devices, NXP, Samsung (SRI-B), Cadence, Broadcom, KLA, GlobalFoundries, Microchip, Salesforce, Adobe, HP', 'every run'),
 ('amazon', 'No', 'amazon.jobs India (incl. AWS FDE / GenAI roles)', 'every run'),
 ('microsoft', 'No', 'Microsoft careers India (IDC)', 'every run'),
 ('linkedin', 'No', 'LinkedIn public jobs search, last 7 days, India + remote', 'every run'),
 ('yc_jobs', 'No', 'Y Combinator / Work at a Startup', 'every run'),
 ('instahyre', 'No', 'Instahyre (Bangalore + India)', 'every run'),
 ('hn', 'No', "Hacker News monthly Who's Hiring", 'hourly'),
 ('reddit', 'No', 'r/MLjobs, r/DataScienceJobs, r/developersIndia, r/mlops, r/forhire', 'hourly'),
 ('telegram', 'No', 't.me/AiIndiaJobs + any channels you add', '30 min'),
 ('remotive', 'No', 'Remotive', '6 h'),
 ('remoteok', 'No', 'Remote OK', 'hourly'),
 ('himalayas', 'No', 'Himalayas', 'every run'),
 ('jobicy', 'No', 'Jobicy', '2 h'),
 ('themuse', 'No', 'The Muse (Bengaluru + remote)', '2 h'),
 ('workingnomads', 'No', 'Working Nomads', 'hourly'),
 ('weworkremotely', 'No', 'We Work Remotely RSS', 'hourly'),
 ('jobspresso', 'No', 'Jobspresso RSS', '2 h'),
 ('jsearch', 'RAPIDAPI_KEY', 'Google for Jobs: LinkedIn, Indeed, Glassdoor, Naukri…', '12 h'),
 ('serpapi', 'SERPAPI_KEY', 'Google Jobs: Naukri, Foundit, Shine, iimjobs, Hirist, Cutshort, Wellfound…', '12 h'),
 ('adzuna', 'ADZUNA_APP_ID + _KEY', 'Adzuna India', '2 h'),
 ('jooble', 'JOOBLE_API_KEY', 'Jooble India', '2 h'),
 ('apify_linkedin', 'APIFY_TOKEN', 'LinkedIn (reliable, paid per result)', '12 h'),
 ('x_official', 'X_BEARER_TOKEN', 'X hiring tweets (official)', '12 h'),
 ('twitterapi_io', 'TWITTERAPI_IO_KEY', 'X hiring tweets (cheap)', '2 h'),
]
story += [P('PART C — Reference', 'h1'), P('C1. Every job source the app calls (29) — plus the AI agent and hidden-jobs scanner on top', 'h2'),
          table([['Source id', 'Key needed', 'Covers', 'Cadence']] + [list(s) for s in SOURCES], [28, 30, 92, 24]),
          Spacer(1, 6),
          P('Add any other company from <b>Settings → Companies</b>: type the slug from its jobs URL (e.g. <font face="DVM">jobs.lever.co/<b>mistral</b></font>, <font face="DVM">job-boards.greenhouse.io/<b>groq</b></font>, <font face="DVM">jobs.ashbyhq.com/<b>sarvam</b></font>) → <b>Auto-detect ATS</b> → <b>Add</b>. Toggle any default company off with one click.'),
          P('C2. How a job is classified &amp; scored', 'h2'),
          table([['What', 'Rule'],
                 ['Role (your rule)', '<b>Only FDE and AI/ML roles are kept.</b> A firmware, RTL, sales or HR job is dropped even at an AI company; an AI/ML or FDE job is kept at ANY company.'],
                 ['FDE', 'forward deployed, FDE, deployment strategist, applied AI engineer/architect, AI deployment engineer, AI/ML/agent solutions · customer · field · implementation engineer/architect, founding AI engineer; or a JD that says "forward deployed"'],
                 ['AI/ML', 'machine learning, ML, AI, LLM, GenAI, deep learning, neural, MLOps, ML/AI platform, applied scientist, AI/ML research, NLP, computer vision, agentic, RAG, inference, perception, speech, recommendation, TinyML / edge AI, ML compiler — with an engineering/science job title'],
                 ['Domain (company industry)', 'Frontier AI lab · AI infra / devtools · Semiconductor / AI silicon · Embedded / Robotics / Automotive · IT / SaaS · Fintech · Healthcare · Defense · Consulting — from the company list tags or the JD wording. Filter by it in the Jobs tab.'],
                 ['Where', 'Bengaluru · India · USA · Remote (India-eligible = worldwide/APAC/India/IST, not “US only”) · Remote (any) · Other onsite'],
                 ['Hidden gem', 'Found on a company board / HN / Telegram / YC / Instahyre (not LinkedIn or big aggregators) at a non-big-brand company → fewer applicants'],
                 ['Score', 'FDE +40 · AI/ML +20 · Bengaluru +20 / India +15 / Remote-India-OK +14 / other remote +6 · posted &lt;24 h +15 / &lt;3 d +10 / &lt;7 d +5 · hidden gem +5 · CV match up to +30']],
                [36, 138]),
          P('Edit keywords, excluded title words (default: intern, account executive, recruiter…) and the alert threshold in <b>Settings</b>.'),
          PageBreak()]

# ---------------- PART C: TABS ----------------
story += [P('C3. Using the dashboard', 'h2'),
          table([['Tab', 'What to do there'],
                 ['Jobs', 'Your personal portal. Filters: Role (FDE / AI-ML) · Where (Bengaluru / India / USA / Remote India-eligible / Remote any) · Domain (semiconductor, embedded, IT, fintech…) · level (junior / mid / senior) · source · posted window · hidden gems · salary shown · new since last visit. Every row: <b>Apply</b> (opens the real application link), <b>AI</b> (fit check vs your CV: score, gaps, how to pitch, cold DM, cover note) and Track.'],
                 ['AI Agent', 'Type what you want (“FDE roles at Bengaluru robotics startups funded this year”) or run a mission: LinkedIn hiring posts · X hiring posts · hidden Bengaluru startups · remote-open-to-India · USA (visa) · AI roles in semiconductor/embedded/robotics · newly funded startups. The agent plans queries, searches the web, verifies every company career board it finds, reads career pages, filters with your AI provider and lists Finds (Apply / Watch / Save / Applied / AI). Missions also run automatically every ~3 h.'],
                 ['Hidden jobs &amp; startups', 'Low-crowd companies: YC companies hiring in Bengaluru/India/remote/USA + freshly funded startups from ET Tech, Inc42, YourStory, TechCrunch, Crunchbase News. Each one is checked for a public careers board and open FDE/AI-ML roles, scored as a “hidden gem”. <b>Watch</b> = its jobs flow into the Jobs tab on every refresh. Scans daily.'],
                 ['AI &amp; Keys', 'Add / order / test AI providers (any model, any third party) and paste every API key into the encrypted vault — no redeploy.'],
                 ['Tracker', 'Kanban: Saved → Applied → Referral asked → Interview → Offer / Rejected / Ignored. Notes per job (referral name, interview date, CTC discussed). Export CSV. Entries survive even after the posting disappears.'],
                 ['Excel sheets', 'All 42 sheets of your workbook, every cell word-for-word (7,178 cells, 1,333 trackable rows). Each row: To do / Doing / Done / Skip + notes. Progress bar per sheet and overall, search across all sheets, filter "not done yet".'],
                 ['Platforms map', 'All 286 platforms from the Excel with how each one is tracked (below). "Open ↗" opens a pre-filled search with your keyword; "✓ checked" stamps the date so you know what is due ("due for a manual check &gt; 3 days" filter).'],
                 ['Sources &amp; APIs', 'Infra checklist + live health of all 29 sources (last run, fetched/relevant counts, exact error) and a Run now button per source.'],
                 ['CV', 'Upload/update CV, version history, view/download, switch active version, edit match skills.'],
                 ['Settings', 'Keywords, excluded words, alert score, Telegram channels, subreddits, sources on/off, ~180 companies on/off + add new companies.']],
                [30, 144]),
          P('C4. Updating the Excel later', 'h2'),
          P('Replace <font face="DVM">data/source_workbook.xlsx</font> in the repo with the new version, run <font face="DVM">pip install openpyxl</font> then <font face="DVM">npm run excel</font>, commit and push — Vercel redeploys in ~1 minute. Row ticks are stored by "sheet:row number", so append new rows at the bottom of a sheet to keep existing ticks aligned.'),
          P('C5. Troubleshooting', 'h2'),
          table([['Symptom', 'Fix'],
                 ['Yellow "memory mode" banner', 'Redis not connected: Storage → Upstash for Redis → Connect to project → Redeploy.'],
                 ['"APP_PASSWORD env var is not set"', 'Add it in Settings → Environment Variables → Redeploy.'],
                 ['CV upload: "Vercel Blob is not connected"', 'Create a Blob store with access Private, connect it, Redeploy.'],
                 ['LinkedIn: "rate-limited this server IP (429/999)"', 'Normal on cloud IPs sometimes. Add RAPIDAPI_KEY (JSearch) and/or APIFY_TOKEN; keep LinkedIn on — it recovers on its own.'],
                 ['A source shows "Cooldown"', 'Working as designed to protect free quota. Use Run now (forces it) or set &lt;ID&gt;_INTERVAL_MIN.'],
                 ['A company in an ATS shows "partial failure"', 'That company moved ATS or renamed its slug. Settings → turn it off, then auto-detect the new slug.'],
                 ['GitHub Action fails with 401', 'CRON_SECRET in GitHub ≠ CRON_SECRET in Vercel, or APP_URL wrong / has a trailing slash.'],
                 ['GitHub Action 409', 'A refresh was already running — harmless.'],
                 ['"A refresh is already running"', 'Wait ~1 min; the lock auto-expires after 2 min even if a run crashed.'],
                 ['No Telegram alerts', 'Send your bot a message first, recheck TELEGRAM_CHAT_ID, use Settings → Send test alert. First-ever refresh never alerts (avoids a flood).'],
                 ['Logged out everywhere wanted', 'Change AUTH_SECRET → Redeploy (then re-enter keys saved in the in-app vault).'],
                 ['AI Agent: “No web-search engine configured”', 'Add a free Tavily key in AI &amp; Keys → API keys vault.'],
                 ['AI: “All AI providers failed → … 429”', 'Free-tier limit hit. Add a second free provider (Groq / OpenRouter) below the first — the chain falls through automatically.'],
                 ['AI: “… 404 / model not found”', 'Click Load models in AI &amp; Keys and pick one from the list (model names change).'],
                 ['Vault keys show “(no key — check AUTH_SECRET)”', 'AUTH_SECRET changed since you saved them — paste the keys again.'],
                 ['Hidden-jobs scan shows few roles', 'Untick “only with open FDE/AI roles”; many YC startups hire through the YC page (YC jobs ↗ button).']],
                [56, 118]),
          P('C6. Monthly cost options', 'h2'),
          table([['Setup', 'What you get', 'Cost'],
                 ['A only', '23 keyless sources, ~180 companies, LinkedIn guest, HN, Reddit, Telegram, YC, Instahyre, 30-min refresh, tracker, CV', '$0'],
                 ['A + JSearch + SerpApi + Adzuna + Jooble', '+ Naukri/Foundit/Shine/iimjobs/Hirist/Cutshort/Wellfound/Indeed/Glassdoor via Google Jobs + 2 India aggregators', '$0 (free tiers)'],
                 ['+ twitterapi.io', '+ X hiring tweets every 2 h', '≈ $1–3'],
                 ['+ Apify LinkedIn', '+ bullet-proof LinkedIn with full JDs', '≈ $0–6 (after $5 credit)'],
                 ['+ X official instead of twitterapi.io', 'Official X data', '≈ $3–10'],
                 ['+ AI (Gemini + Groq + OpenRouter free)', 'AI agent filtering, career-page reading, fit checks, cover notes', '$0 (rate-limited)'],
                 ['+ Agent web search (Tavily + Firecrawl + Exa + Linkup free)', '≈ 3,000+ agent searches / month', '$0'],
                 ['+ Claude / OpenAI instead', 'Best quality analysis', '≈ $2–10 (pay per use)']],
                [52, 92, 30]),
          PageBreak()]

# ---------------- APPENDIX: PLATFORMS ----------------
plat = json.load(open('data/platforms.json'))
LBL = {'live_api': 'LIVE API/feed', 'live_ats': 'LIVE company ATS', 'aggregated': 'LIVE via aggregator', 'deep_link': '1-click search', 'resource': 'Resource / checklist', 'excluded': 'Excluded'}
from collections import Counter
cnt = Counter(p['mapping'] for p in plat)
story += [P('Appendix — all %d platforms from your Excel, mapped' % len(plat), 'h1'),
          P(' · '.join(f'<b>{LBL[k]}</b>: {cnt.get(k, 0)}' for k in LBL)),
          P('<b>LIVE API/feed</b> and <b>LIVE company ATS</b> = pulled automatically every refresh. <b>LIVE via aggregator</b> = no public API; postings arrive through SerpApi / JSearch (Google Jobs) or LinkedIn once those keys are added, and you can one-click search them. <b>1-click search</b> = no API and bot-protected; open from the Platforms tab and tick "checked". <b>Resource</b> = tools, certifications, newsletters, funding trackers, communities — tracked as a checklist (Excel sheets tab). <b>Excluded</b> = defunct (Hired, Papers with Code jobs, Honeypot).'),
          table([['#', 'Platform', 'How tracked', 'Connector(s)', 'Excel sheet(s)']] +
                [[str(i + 1), e(p['name']) + f'<br/><font color="#5d6673">{e(p["host"])}</font>', LBL[p['mapping']], e(', '.join(p['connectors'])) or '—', e(', '.join(p['sheets']))] for i, p in enumerate(plat)],
                [8, 58, 26, 38, 44], style='tiny')]

def on_page(c, d):
    c.saveState(); c.setFont('DV', 7.5); c.setFillColor(MUTED)
    c.drawString(18 * mm, 10 * mm, 'FDE Job Finder — Setup, API & Deploy Guide')
    c.drawRightString(192 * mm, 10 * mm, f'Page {d.page}'); c.restoreState()

doc = SimpleDocTemplate('docs/FDE_Job_Finder_Setup_Guide.pdf', pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                        title='FDE Job Finder — Setup, API & Deploy Guide', author='Karthik')
doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print('ok')
