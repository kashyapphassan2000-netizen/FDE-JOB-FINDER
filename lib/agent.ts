import { dateFromUrl, isSocialPost } from './postdate';
import type { Category, CompanyEntry, Domain, RawJob } from './types';
import { classify, domainOf, hashId, isExcluded, locationAllowed, locationTags } from './classify';
import { atsFromUrl, probe } from './atsdetect';
import { availableEngines, readPage, searchUsage, webSearch, webSearchAll, type Recency, type WebResult } from './search';
import { aiConfigured, chatJson } from './llm';
import { getCv } from './cv';
import { getSettings } from './settings';
import { DEFAULT_COMPANIES } from './companies';
import { getJSON, hdel, hgetall, hset, setJSON } from './store';
import { loadVault } from './secrets';
import { pool } from './http';
import { fetchTweet, tweetIdFromUrl } from './xposts';
import { sendAlert } from './notify';

/**
 * The job-hunting agent. Scope (your rule): ONLY FDE + AI/ML roles, ANY company domain.
 * Location rule: Bengaluru office, otherwise remote and open to people in India.
 *
 * Deep loop:
 *   1. PLAN      — AI writes 14-18 queries (X posts, LinkedIn posts, ATS boards, career pages, news, communities)
 *   2. SEARCH    — every query on EVERY configured engine (deep) with the right freshness (posts = last 7 days)
 *   3. READ X    — every x.com post found is read in full (text, author, date, links) via the public embed endpoint
 *   4. VERIFY    — company ATS boards in any link are opened live and their FDE/AI roles listed
 *   5. CLASSIFY  — ALL results, in parallel batches, by AI (keeps "maybe" items too, flagged)
 *   6. FOLLOW UP — AI writes follow-up queries from what was found (companies → careers pages, people → posts)
 *   7. DEEP READ — promising careers pages are opened and their roles extracted
 *   8. SAVE + ALERT
 */
export interface Mission { id: string; title: string; desc: string; queries: string[]; recency?: Recency }

/** What each tab is allowed to search when you type a plain-English request inside it. */
export const SCOPE: Record<string, string> = {
  'x-posts': 'ONLY X/Twitter posts: every query must start with site:x.com and contain a hiring phrase (hiring, "we\'re hiring", "join us", "DM me", "looking for").',
  'li-posts': 'ONLY LinkedIn posts: every query must start with site:linkedin.com/posts and contain a hiring phrase.',
  'blr-hidden': 'ONLY Bengaluru roles at startups and lesser-known companies: company career boards (site:jobs.ashbyhq.com, site:jobs.lever.co, site:job-boards.greenhouse.io, site:apply.workable.com) and careers pages, always with Bengaluru OR Bangalore.',
  'remote-india': 'ONLY remote roles open to people in India (remote India, APAC, worldwide, anywhere) — boards, careers pages and posts.',
  'global-remote': 'ONLY US/EU/global companies hiring fully remote worldwide or from India (contractor/EOR welcome).',
  domains: 'ONLY AI/ML/FDE roles at semiconductor, embedded, edge-AI, robotics and automotive companies (Bengaluru or remote).',
  'new-startups': 'ONLY newly funded AI startups (seed / Series A/B, YC) that are hiring — funding news and their careers pages.',
  communities: 'ONLY community channels: news.ycombinator.com, reddit.com, indiehackers.com, latent.space, producthunt.com, dev communities.',
};

const ROLE = '("forward deployed" OR "applied AI" OR "AI engineer" OR "ML engineer" OR "machine learning engineer" OR "LLM engineer" OR "GenAI engineer")';
const HIRE = '(hiring OR "we\'re hiring" OR "join us" OR "we\'re looking" OR "DM me")';

export const MISSIONS: Mission[] = [
  {
    id: 'x-posts', title: 'X / Twitter hiring posts', desc: 'Founders & AI teams tweeting roles (Excel formula: hiring × AI/FDE × remote/India/Bangalore, last 7 days). Every post is read in full.', recency: 'week',
    queries: [
      `site:x.com ${HIRE} "forward deployed"`, `site:x.com hiring "forward deployed engineer" remote`, `site:x.com hiring "forward deployed" (India OR Bangalore OR Bengaluru)`,
      `site:x.com ${HIRE} ("AI engineer" OR "ML engineer" OR "LLM engineer") remote`, `site:x.com ${HIRE} ("AI engineer" OR "ML engineer") (Bangalore OR Bengaluru OR India)`,
      `site:x.com "we're hiring" "founding engineer" AI`, `site:x.com hiring "applied AI" engineer`, `site:x.com hiring (GenAI OR LLM OR agents) engineer "DM"`,
      `site:x.com hiring "AI engineer" remote worldwide OR anywhere`, `site:x.com hiring "solutions engineer" OR "deployment engineer" AI`,
      `site:x.com "is hiring" "forward deployed"`, `site:x.com "join our team" AI engineer startup`,
    ],
  },
  {
    id: 'li-posts', title: 'LinkedIn hiring posts', desc: 'Founders / hiring managers posting FDE & AI roles in their feed (often never on job boards)', recency: 'week',
    queries: [
      `site:linkedin.com/posts "forward deployed engineer" hiring`, `site:linkedin.com/posts hiring "forward deployed" (Bengaluru OR Bangalore OR remote)`,
      `site:linkedin.com/posts "we are hiring" ("AI engineer" OR "ML engineer" OR "GenAI") Bengaluru`, `site:linkedin.com/posts hiring "AI engineer" remote India`,
      `site:linkedin.com/posts hiring ("applied AI" OR "founding AI engineer") India`, `site:linkedin.com/posts "DM me" hiring ("LLM" OR "GenAI" OR "AI engineer")`,
      `site:linkedin.com/posts "comment interested" OR "drop your CV" AI engineer Bangalore`, `site:linkedin.com/posts hiring "solutions engineer" OR "deployment engineer" AI India`,
    ],
  },
  { id: 'blr-hidden', title: 'Hidden Bengaluru AI startups', desc: 'Startup career boards (Ashby/Lever/Greenhouse/Workable) with Bengaluru FDE & AI roles',
    queries: [`site:jobs.ashbyhq.com (Bengaluru OR Bangalore) ${ROLE}`, `site:jobs.lever.co (Bengaluru OR Bangalore) ("AI" OR "machine learning" OR "forward deployed")`, `site:job-boards.greenhouse.io (Bengaluru OR Bangalore) ("AI engineer" OR "machine learning" OR "forward deployed")`, `site:apply.workable.com Bangalore ("AI engineer" OR "machine learning")`, `Bengaluru AI startup careers "founding" ("AI engineer" OR "forward deployed")`, `site:jobs.ashbyhq.com "Bengaluru" "LLM"`, `site:jobs.lever.co Bengaluru ("GenAI" OR "LLM" OR "agentic")`, `site:job-boards.greenhouse.io Bengaluru ("applied AI" OR "solutions engineer" OR "deployment")`, `site:wellfound.com Bengaluru AI engineer startup`, `site:ycombinator.com/companies India AI hiring`, `Bengaluru seed startup "AI engineer" careers apply`] },
  { id: 'remote-india', title: 'Remote roles open to India', desc: 'Worldwide / APAC remote FDE & AI roles Indians can take',
    queries: [`"forward deployed engineer" remote ("anywhere" OR "worldwide" OR "APAC" OR "India")`, `remote "AI engineer" ("work from anywhere" OR worldwide OR "remote - India") hiring`, `remote "machine learning engineer" "India" contract OR full-time AI startup`, `site:jobs.ashbyhq.com remote ("India" OR "APAC") ("AI" OR "forward deployed")`, `site:jobs.lever.co "remote - india" ("AI" OR "machine learning")`, `site:job-boards.greenhouse.io "Remote - India" ("AI" OR "ML" OR "LLM")`, `site:apply.workable.com "Remote" India "machine learning"`, `"remote" "India" "forward deployed" OR "solutions engineer" AI startup hiring`, `site:weworkremotely.com OR site:remotive.com AI engineer worldwide`, `"APAC" remote "AI engineer" OR "ML engineer" hiring`] },
  { id: 'global-remote', title: 'US / EU startups hiring remote worldwide', desc: 'Remote FDE & AI roles at foreign companies that hire from India (contract or full-time)',
    queries: [`"forward deployed engineer" remote "worldwide" OR "anywhere in the world"`, `site:jobs.ashbyhq.com remote ("anywhere" OR "worldwide" OR "global") ("AI engineer" OR "forward deployed")`, `"AI engineer" remote "hire from India" OR "contractors in India" OR "EOR" startup`, `site:jobs.lever.co remote worldwide ("applied AI" OR "machine learning engineer")`, `"we hire globally" OR "hire anywhere" AI engineer startup`, `site:job-boards.greenhouse.io "Remote" "Anywhere" ("LLM" OR "forward deployed")`, `"Deel" OR "Remote.com" EOR startup hiring "AI engineer" worldwide`, `site:workatastartup.com remote AI engineer`, `"fully remote" "forward deployed engineer" US startup`] },
  { id: 'domains', title: 'AI roles in semiconductor / embedded / robotics', desc: 'FDE & AI/ML roles at chip, edge-AI, robotics, automotive companies',
    queries: [`(Bengaluru OR Bangalore) ("edge AI" OR "on-device AI" OR "embedded AI") engineer hiring`, `(Bengaluru OR Bangalore) semiconductor "machine learning engineer" OR "AI engineer"`, `"ML compiler" OR "AI compiler" engineer Bengaluru hiring`, `robotics startup Bengaluru "AI engineer" OR "perception engineer" OR "forward deployed"`, `(NVIDIA OR Qualcomm OR AMD OR Intel OR Samsung) Bengaluru "AI" engineer LLM hiring`, `"TinyML" OR "on-device LLM" engineer remote OR Bengaluru`, `automotive "AI engineer" OR "GenAI" Bengaluru (Bosch OR Mercedes OR Continental OR Harman)`, `"ML inference" OR "model optimization" engineer Bengaluru chip`] },
  { id: 'new-startups', title: 'Newly funded AI startups hiring', desc: 'Excel "Funding-alert pre-JD": startups that just raised — reach the founder before the JD exists', recency: 'week',
    queries: [`AI startup raises seed OR "Series A" Bengaluru hiring engineers`, `"raised" "Series A" AI agents startup hiring "forward deployed"`, `YC AI startup India hiring "founding engineer"`, `site:inc42.com funding AI startup`, `site:yourstory.com funding AI startup raises`, `site:entrackr.com AI startup raises`, `site:techcrunch.com AI startup raises Series A`, `"just raised" AI startup "we're hiring" engineers`, `YC W26 OR S26 AI startup India founders hiring`, `seed round AI agents startup India 2026 hiring`, `site:economictimes.indiatimes.com AI startup funding hiring`] },
  { id: 'communities', title: 'Communities & newsletters', desc: 'Excel channels: HN Who is Hiring, r/developersIndia referrals, r/MachineLearning, Latent Space, Indie Hackers, Product Hunt AI launches', recency: 'month',
    queries: [`site:news.ycombinator.com "who is hiring" remote AI engineer`, `site:reddit.com/r/developersIndia referral AI engineer`, `site:reddit.com/r/MachineLearning hiring remote`, `site:indiehackers.com hiring AI engineer`, `site:latent.space jobs AI engineer`, `site:producthunt.com AI launch hiring`, `site:reddit.com/r/forhire "AI engineer" OR "ML engineer"`, `site:reddit.com/r/MLjobs hiring remote`, `site:discord.com OR site:slack.com AI jobs channel India`, `site:dev.to OR site:hashnode.com hiring AI engineer`, `"who wants to be hired" OR "who is hiring" AI remote India`] },
];

const SYSTEM = `You are a sharp job-hunting agent for Karthik (Bengaluru, India; moving into AI engineering).
Target roles ONLY: Forward Deployed Engineer (incl. applied AI engineer/architect, AI solutions/deployment engineer, founding AI engineer) and AI/ML roles (ML engineer, AI engineer, LLM/GenAI engineer, MLOps, applied scientist, edge/embedded AI).
ANY company domain is fine. Reject non-AI roles (pure firmware, RTL, sales, HR, marketing) and job seekers' own "open to work" posts.
LOCATION RULE (strict): the ONLY office he can attend is Bengaluru. Everything else must be REMOTE and open to people living in India (worldwide / APAC / India remote). Reject onsite or hybrid roles in any other city or country, and remote roles restricted to US/EU/UK/Canada residents. If location is not stated, keep it.`;

export interface Find {
  id: string;
  kind: 'job' | 'post' | 'careers_page' | 'company';
  title: string;
  company: string;
  location: string;
  url: string;
  snippet: string;
  why: string;
  role: Category[];
  domain: Domain;
  locTags: string[];
  mission: string;
  missions?: string[]; // every tab that found it (a post can belong to X and to a custom search)
  engine: string;
  foundAt: string;
  status: 'new' | 'saved' | 'dismissed' | 'applied';
  ats?: { ats: CompanyEntry['ats']; slug: string; total: number; relevant: number };
  author?: string; // posts: "Name (@handle)"
  postedAt?: string | null;
  applyHow?: string; // "DM the author", "email jobs@acme.ai", "apply: <link>"
  confidence?: 'high' | 'maybe';
}

/** Fresh only: posts/jobs older than 30 days (by post date, else by when we found them) are hidden unless you saved/applied. */
export const FIND_FRESH_DAYS = 30;
export function isFreshFind(f: Find): boolean {
  if (f.status === 'saved' || f.status === 'applied') return true;
  const t = findTime(f);
  if (t === null) return false; // social post with no provable date → not shown as fresh
  return Date.now() - t < FIND_FRESH_DAYS * 864e5;
}

/** Real post time: from the URL for X / LinkedIn, else the stored post date, else (non-social only) when we found it. */
export function findTime(f: Pick<Find, 'url' | 'postedAt' | 'foundAt'>): number | null {
  const real = dateFromUrl(f.url);
  if (real) return Date.parse(real);
  if (f.postedAt && Date.parse(f.postedAt)) return Date.parse(f.postedAt);
  if (isSocialPost(f.url)) return null;
  return Date.parse(f.foundAt) || null;
}

/** With the real post date filled in (what the UI and exports show). */
export const withRealDate = <T extends Find>(f: T): T => ({ ...f, postedAt: dateFromUrl(f.url) || f.postedAt || null });

/** Delete finds older than 30 days by their REAL date (saved / applied are kept). */
export async function purgeOldFinds(): Promise<number> {
  const all = await hgetall<Find>('agent:finds');
  const victims = Object.values(all).filter((f) => f.status !== 'saved' && f.status !== 'applied' && !isFreshFind(f));
  await pool(victims, 10, (f) => hdel('agent:finds', f.id));
  return victims.length;
}

export interface AgentRun {
  id: string; mission: string; prompt?: string; depth: 'quick' | 'deep'; startedAt: string; ms: number; queries: string[];
  engines: string[]; ai: string | null; log: string[]; finds: number; total: number; companies: number; searches: number; findIds: string[]; error?: string;
}

type Hit = WebResult & { author?: string; stale?: boolean };

const watchedKeys = (extra: CompanyEntry[]) => new Set([...DEFAULT_COMPANIES, ...extra].map((c) => `${c.ats}:${c.slug}`.toLowerCase()));
const isPostUrl = (u: string) => /linkedin\.com\/(posts|feed)|(x|twitter)\.com\/[^/]+\/status|reddit\.com\/r\/.+\/comments|news\.ycombinator\.com\/item/.test(u);
const HIRING_RX = /hiring|we('|’)re hiring|we are hiring|join (us|our)|open role|looking for|dm me|send (your )?(cv|resume)|apply|opening/i;
const MAX_POST_AGE_DAYS = 30;
/** How old a dated post may be for a search window: last 24 h → 2 days (time zones), week → 8, month/any → 30. */
const windowDays = (rec: Recency) => (rec === 'day' ? 2 : rec === 'week' ? 8 : MAX_POST_AGE_DAYS);
const isJobLink = (u: string) => !atsFromUrl(u) || /\/(jobs?|j)\/|[0-9a-f-]{20,}/.test(u);

function heuristic(r: Hit): Partial<Find> | null {
  const text = `${r.title} ${r.snippet}`;
  const roles = Array.from(new Set([...classify({ title: r.title, company: '', location: '', url: r.url, description: r.snippet }), ...classify({ title: r.snippet.slice(0, 300), company: '', location: '', url: r.url })]));
  if (!roles.length) return null;
  const isPost = isPostUrl(r.url);
  if (isPost && !HIRING_RX.test(text)) return null;
  return { kind: isPost ? 'post' : 'job', title: r.title.slice(0, 200), role: roles, why: 'keyword match (add an AI provider for smarter filtering)', confidence: 'maybe', author: r.author };
}

function applyHowFrom(text: string): string {
  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (email) return `email ${email}`;
  if (/\bdm\b|dms open|message me/i.test(text)) return 'DM the author';
  const link = text.match(/https?:\/\/[^\s)]+/)?.[0];
  if (link && !/x\.com|twitter\.com|t\.co\//.test(link)) return `apply: ${link}`;
  return '';
}

function fallbackPlan(prompt: string): string[] {
  return [
    prompt, `${prompt} hiring`, `site:x.com ${prompt} hiring`, `site:x.com hiring ${prompt} remote`, `site:linkedin.com/posts ${prompt} hiring`,
    `${prompt} (site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:job-boards.greenhouse.io)`, `${prompt} careers Bengaluru`, `${prompt} remote India`,
  ];
}

export async function runAgent(opts: { missionId?: string; prompt?: string; budgetMs?: number; depth?: 'quick' | 'deep'; alert?: boolean; recency?: Recency }): Promise<AgentRun> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 260000;
  const left = () => budget - (Date.now() - t0);
  const depth = opts.depth || 'deep';
  await loadVault();
  const settings = await getSettings();
  const mission = MISSIONS.find((m) => m.id === opts.missionId);
  const run: AgentRun = { id: `r${Date.now().toString(36)}`, mission: mission?.id || 'custom', prompt: opts.prompt, depth, startedAt: new Date().toISOString(), ms: 0, queries: [], engines: availableEngines().map((e) => e.id), ai: null, log: [], finds: 0, total: 0, companies: 0, searches: 0, findIds: [] };
  const log = (s: string) => run.log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
  const hasAI = await aiConfigured();
  const finds: Find[] = [];
  const now = new Date().toISOString();

  const mk = (r: Hit, f: Partial<Find>): Find => {
    const loc = f.location || '';
    const raw: RawJob = { title: f.title || r.title, company: f.company || '', location: loc, url: r.url, description: r.snippet };
    return {
      id: hashId(r.url), kind: f.kind || 'job', title: (f.title || r.title).slice(0, 220), company: (f.company || '').slice(0, 100), location: loc.slice(0, 120),
      url: r.url, snippet: r.snippet.slice(0, 1500), why: (f.why || '').slice(0, 300), role: f.role?.length ? f.role : classify(raw),
      domain: f.domain || domainOf(raw), locTags: f.locTags || locationTags({ ...raw, location: loc }),
      mission: run.mission, engine: r.engine, foundAt: now, status: 'new', ats: f.ats, author: f.author || r.author, postedAt: dateFromUrl(r.url) || f.postedAt || (isSocialPost(r.url) ? null : r.date) || null,
      applyHow: f.applyHow || applyHowFrom(r.snippet), confidence: f.confidence || 'high',
    };
  };

  const seen = new Set<string>();
  let oldDropped = 0;
  const searchAll = async (queries: string[], rec: Recency): Promise<Hit[]> => {
    const out: Hit[] = [];
    const res = await pool(queries, 4, (q) => (depth === 'deep' ? webSearchAll(q, 20, rec) : webSearch(q, 10, rec).then((r) => ({ ...r, engines: r.engine ? [r.engine] : [] }))));
    res.forEach((r, i) => {
      if (r.status !== 'fulfilled') return void log(`search failed: ${queries[i]}`);
      run.searches += Math.max(1, r.value.engines.length);
      r.value.errors.forEach((e) => log(`engine error ${e}`));
      for (const x of r.value.results) {
        const tid = tweetIdFromUrl(x.url);
        if (tid) x.url = x.url.replace(/^(https?:\/\/)(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/]+)\/status(?:es)?\/(\d+).*$/i, 'https://x.com/$2/status/$3'); // one canonical URL per tweet
        const k = tid ? `x:${tid}` : x.url.split('#')[0].replace(/\?.*$/, '');
        // real publish time from the URL (X / LinkedIn); search-engine dates on social posts are crawl dates → ignored
        const real = dateFromUrl(x.url);
        if (real) x.date = real;
        else if (isSocialPost(x.url)) x.date = undefined;
        if (/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/?(?:all|reposts|with_replies|media|likes)?\/?(?:\?.*)?$/i.test(x.url) && !tid) continue; // a profile page, not a post
        if (real && Date.now() - Date.parse(real) > windowDays(rec) * 864e5) { (x as Hit).stale = true; oldDropped++; }
        if (!seen.has(k)) { seen.add(k); out.push(x); }
      }
    });
    return out;
  };

  // X posts: read every one in full, drop old ones
  const readX = async (results: Hit[]) => {
    const xs = results.filter((r) => tweetIdFromUrl(r.url));
    if (!xs.length) return;
    const got = await pool(xs.slice(0, 80), 8, async (r) => ({ r, t: await fetchTweet(tweetIdFromUrl(r.url)!) }));
    let read = 0, old = 0;
    for (const g of got) {
      if (g.status !== 'fulfilled' || !g.value.t) continue;
      const { r, t } = g.value;
      read++;
      if (t.createdAt && Date.now() - Date.parse(t.createdAt) > MAX_POST_AGE_DAYS * 864e5) { old++; r.stale = true; continue; }
      r.author = `${t.author} (@${t.handle})`;
      r.title = r.author;
      r.snippet = `${t.text}${t.links.length ? `\nLinks: ${t.links.join(' ')}` : ''}`;
      r.date = t.createdAt;
    }
    log(`X: read ${read}/${xs.length} posts in full${old ? `, ${old} older than ${MAX_POST_AGE_DAYS} days dropped` : ''}`);
  };

  // ATS boards: verify live and list their FDE/AI roles in your locations
  const watched = watchedKeys(settings.extraCompanies);
  const probedKeys = new Set<string>();
  const verifyBoards = async (results: Hit[]) => {
    const boards = new Map<string, { ats: CompanyEntry['ats']; slug: string; r: Hit }>();
    for (const r of results) {
      const a = atsFromUrl(r.url);
      const k = a && `${a.ats}:${a.slug}`.toLowerCase();
      if (a && k && !boards.has(k) && !probedKeys.has(k)) boards.set(k, { ...a, r });
    }
    const toProbe = [...boards.entries()].filter(([k]) => !watched.has(k)).slice(0, depth === 'deep' ? 30 : 15);
    toProbe.forEach(([k]) => probedKeys.add(k));
    const probed = await pool(toProbe, 6, async ([, b]) => ({ b, d: await probe(b.ats, b.slug, b.slug) }));
    let n = 0;
    for (const p of probed) {
      if (p.status !== 'fulfilled' || !p.value.d) continue;
      const { b, d } = p.value;
      const rel = d.jobs.filter((j) => classify(j).length && locationAllowed(locationTags(j), j.location));
      const pretty = (x: string) => x.split('|')[0].replace(/[-_]+/g, ' ').replace(/\b(llc|inc|hq|careers|jobs)\b/gi, '').trim().replace(/\b\w/g, (c) => c.toUpperCase());
      const company = d.jobs[0]?.company && d.jobs[0].company !== b.slug && !d.jobs[0].company.includes('|') ? d.jobs[0].company : pretty(b.slug);
      n++;
      finds.push(mk(b.r, { kind: 'company', title: `${company} — ${rel.length} FDE/AI roles for you (${d.total} open) on ${b.ats}`, company, why: 'Career board found in search results and verified live. "Watch" pulls its jobs on every refresh.', ats: { ats: b.ats, slug: b.slug, total: d.total, relevant: rel.length } }));
      for (const j of rel.slice(0, 10)) finds.push(mk({ title: j.title, url: j.url, snippet: j.description || '', engine: `ats:${b.ats}`, date: j.postedAt }, { kind: 'job', title: j.title, company, location: j.location, why: `Open on ${company}'s ${b.ats} board (verified live)` }));
    }
    run.companies += n;
    log(`ATS boards: ${boards.size} seen, ${toProbe.length} probed, ${n} verified`);
  };

  // AI classification of everything (parallel batches of 30)
  const careerPages: Hit[] = [];
  const classifyAll = async (rest: Hit[]) => {
    if (!rest.length) return;
    if (!hasAI || left() < 40000) {
      for (const r of rest) { const h = heuristic(r); if (h) finds.push(mk(r, h)); }
      log(`keyword filter → ${rest.length} results checked${hasAI ? ' (time budget low)' : ' (no AI provider set)'}`);
      return;
    }
    const batches: Hit[][] = [];
    for (let i = 0; i < rest.length; i += 18) batches.push(rest.slice(i, i + 18)); // small batches fit free-tier token limits
    let kept = 0;
    const res = await pool(batches, 2, async (batch) => {
      const items = batch.map((r, i) => ({ i, title: r.title, url: r.url, date: r.date || '', text: r.snippet.slice(0, isPostUrl(r.url) ? 650 : 300) }));
      const { data, meta } = await chatJson<{ items: { i: number; relevant: 'yes' | 'maybe' | 'no'; kind: Find['kind']; title: string; company: string; location: string; role: string[]; domain: Domain; why: string; apply_how: string }[] }>(SYSTEM,
        `Classify these web results. Keep real FDE or AI/ML job postings, real hiring posts by companies/founders/employees (X, LinkedIn, Reddit, HN), and company careers pages likely listing such roles. Use "maybe" when it could be relevant but details are missing — do not drop possible opportunities.
For posts: title = the role being hired for, company = hiring company, location = what the post says, apply_how = how to apply (email address, "DM", form/link) if stated.
Results:\n${JSON.stringify(items)}\nJSON: {"items":[{"i":0,"relevant":"yes|maybe|no","kind":"job|post|careers_page","title":"clean role title","company":"","location":"city/country/remote scope or not stated","role":["FDE"|"AIML"],"domain":"AI_LAB|AI_INFRA|SEMI|EMBEDDED|IT|FINTECH|HEALTH|DEFENSE|CONSULTING|OTHER","why":"max 20 words","apply_how":""}]}`,
        { maxTokens: 3000, timeoutMs: Math.min(100000, left() - 15000) });
      run.ai = `${meta.provider} · ${meta.model}`;
      for (const it of data?.items || []) {
        const r = batch[it.i];
        if (!r || it.relevant === 'no' || !it.relevant) continue;
        if (it.kind === 'careers_page') careerPages.push(r);
        kept++;
        finds.push(mk(r, { kind: it.kind || (isPostUrl(r.url) ? 'post' : 'job'), title: it.title, company: /^(not (stated|provided|specified|mentioned)|unknown|n\/a|none)$/i.test((it.company || '').trim()) ? '' : it.company, location: /not stated/i.test(it.location || '') ? '' : it.location, role: (Array.isArray(it.role) ? it.role : String(it.role || '').split(/[,/ ]+/)).map((x) => (/fde|forward/i.test(x) ? 'FDE' : /ai|ml/i.test(x) ? 'AIML' : '')).filter(Boolean) as Category[], domain: it.domain, why: it.why, applyHow: it.apply_how, confidence: it.relevant === 'maybe' ? 'maybe' : 'high' }));
      }
    });
    const failed = res.filter((r) => r.status === 'rejected');
    if (failed.length) {
      log(`AI classification failed for ${failed.length}/${batches.length} batches (${String(((failed[0] as PromiseRejectedResult).reason as Error)?.message).slice(0, 300)}) → keyword filter for those`);
      res.forEach((r, i) => { if (r.status === 'rejected') for (const x of batches[i]) { const h = heuristic(x); if (h) finds.push(mk(x, h)); } });
    }
    log(`classified ${rest.length} results in ${batches.length} batches → ${kept} relevant (${run.ai || 'keywords'})`);
  };

  try {
    if (!run.engines.length) throw new Error('No web-search engine configured. Add a free Tavily / Exa / Serper / Firecrawl / Linkup key (or your SearXNG URL) in "AI & Keys".');

    // 1. PLAN
    let queries = mission?.queries || [];
    let rec: Recency = opts.recency || mission?.recency || 'month';
    if (opts.prompt) {
      const scope = mission ? SCOPE[mission.id] : '';
      const wantsPosts = !mission && /twitter|\bx\b|tweet|post|linkedin/i.test(opts.prompt);
      rec = /today|24 ?h|last day/i.test(opts.prompt) ? 'day' : /week|7 days|recent|latest|new/i.test(opts.prompt) || wantsPosts ? 'week' : 'month';
      if (hasAI) {
        try {
          const { data, meta } = await chatJson<{ queries: string[] }>(SYSTEM,
            `Turn this request into ${depth === 'deep' ? 16 : 8} precise, DIFFERENT web-search queries (Google syntax: quotes, OR, site:) that together leave nothing out.
Cover every angle that fits the request: X/Twitter posts (site:x.com with hiring phrases like hiring, "we're hiring", "join us", "DM me"), LinkedIn posts (site:linkedin.com/posts), company boards (site:jobs.ashbyhq.com, site:jobs.lever.co, site:job-boards.greenhouse.io, site:apply.workable.com), careers pages, startup/funding news, communities (news.ycombinator.com, reddit).
Vary role wording (forward deployed / applied AI / AI engineer / ML engineer / LLM / GenAI / founding engineer) and location wording (Bengaluru, Bangalore, remote India, remote worldwide). Never put date words like "past week" in queries.
${scope ? `SCOPE (strict): ${scope}\n` : ''}Request: ${opts.prompt}\nJSON: {"queries":["..."]}`, { maxTokens: 1500 });
          run.ai = `${meta.provider} · ${meta.model}`;
          if (data?.queries?.length) queries = data.queries.map((q) => q.replace(/"?(past|last) (week|month|7 days|24 hours)"?/gi, '').trim()).filter(Boolean).slice(0, depth === 'deep' ? 18 : 9);
          log(`planned ${queries.length} queries with ${run.ai}`);
        } catch (e) {
          log(`AI planning failed (${(e as Error).message.slice(0, 120)}) → keyword plan`);
        }
      }
      if (!queries.length || queries === mission?.queries) queries = mission ? mission.queries.map((q) => `${q} ${opts.prompt}`.slice(0, 250)) : fallbackPlan(opts.prompt);
      else if (mission && depth === 'deep') queries = [...queries, ...mission.queries.slice(0, 6)]; // your request + the tab's standard sweep
      if (wantsPosts && !queries.some((q) => q.includes('site:x.com'))) queries.push(...MISSIONS[0].queries.slice(0, 4));
    } else if (depth === 'quick') queries = queries.slice(0, 6);
    run.queries = [...queries];

    // 2. SEARCH
    const results = await searchAll(queries, rec);
    log(`search: ${results.length} unique results from ${queries.length} queries (${run.searches} engine calls, freshness: ${rec})`);

    // 3. READ X posts in full
    await readX(results);
    const fresh = results.filter((r) => !r.stale);

    // 4. VERIFY ATS boards
    await verifyBoards(fresh);

    // 5. CLASSIFY everything else
    await classifyAll(fresh.filter((r) => isJobLink(r.url)));

    // 6. FOLLOW UP (deep)
    if (depth === 'deep' && hasAI && left() > 110000) {
      const top = finds.filter((f) => f.kind !== 'company').slice(0, 25).map((f) => `${f.kind}: ${f.title} @ ${f.company} (${f.location || 'n/a'})`).join('\n');
      if (top) {
        try {
          const { data } = await chatJson<{ queries: string[] }>(SYSTEM,
            `Here is what a first search round found:\n${top}\n\nWrite 6 follow-up web-search queries that find MORE opportunities the first round missed: other roles at these companies (their careers pages / ATS boards), similar companies, and more hiring posts in the same niche. Google syntax. JSON: {"queries":["..."]}`, { maxTokens: 700, timeoutMs: 30000 });
          const fq = (data?.queries || []).slice(0, 6);
          if (fq.length) {
            run.queries.push(...fq.map((q) => `↳ ${q}`));
            const more = await searchAll(fq, rec === 'day' ? 'week' : rec);
            log(`follow-up: ${more.length} new results from ${fq.length} queries`);
            await readX(more);
            const moreFresh = more.filter((r) => !r.stale);
            await verifyBoards(moreFresh);
            await classifyAll(moreFresh.filter((r) => isJobLink(r.url)));
          }
        } catch (e) {
          log(`follow-up skipped: ${(e as Error).message.slice(0, 100)}`);
        }
      }
    }

    // 7. DEEP READ careers pages
    if (hasAI && careerPages.length && left() > 60000) {
      const pages = careerPages.slice(0, depth === 'deep' ? 6 : 3);
      const read = await pool(pages, 3, async (p) => ({ p, text: await readPage(p.url, 12000) }));
      for (const x of read) {
        if (x.status !== 'fulfilled' || left() < 25000) continue;
        try {
          const { data } = await chatJson<{ jobs: { title: string; location: string; url: string }[]; company: string }>(SYSTEM,
            `From this careers page, list ONLY FDE / AI-ML roles with their location and absolute apply URL (use the page URL if none).\nPage URL: ${x.value.p.url}\n---\n${x.value.text}\n---\nJSON: {"company":"","jobs":[{"title":"","location":"","url":""}]}`, { maxTokens: 1500, timeoutMs: Math.min(50000, left() - 15000) });
          for (const j of data?.jobs || []) {
            const url = /^https?:/.test(j.url) ? j.url : x.value.p.url;
            finds.push(mk({ title: j.title, url, snippet: `From careers page ${x.value.p.url}`, engine: 'reader' }, { kind: 'job', title: j.title, company: data?.company || '', location: j.location, why: 'Read directly from the company careers page' }));
          }
          log(`read ${x.value.p.url} → ${(data?.jobs || []).length} roles`);
        } catch (e) {
          log(`read failed ${x.value.p.url}: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    }

    // 8. SAVE (keep your status on finds you already triaged) + ALERT
    const existing = await hgetall<Find>('agent:finds');
    const ids = new Set<string>();
    const newOnes: Find[] = [];
    for (const f of finds) {
      if (ids.has(f.id)) continue;
      if (f.postedAt && Date.now() - Date.parse(f.postedAt) > MAX_POST_AGE_DAYS * 864e5) continue; // old post / job → never saved
      if (f.kind !== 'company' && !f.role.length) continue;
      if (f.kind === 'job' && f.location && !locationAllowed(f.locTags, f.location)) continue;
      if (f.kind !== 'company' && isExcluded({ title: f.title, company: f.company, location: f.location, url: f.url }, settings)) continue;
      ids.add(f.id);
      const prev = existing[f.id];
      if (prev) { await hset('agent:finds', f.id, { ...f, status: prev.status, foundAt: prev.foundAt, postedAt: f.postedAt || prev.postedAt, missions: Array.from(new Set([...(prev.missions || [prev.mission]), f.mission])) }); continue; }
      await hset('agent:finds', f.id, { ...f, missions: [f.mission] });
      newOnes.push(f);
    }
    const handles = newOnes.filter((f) => f.kind === 'post' && f.confidence !== 'maybe' && /\(@([A-Za-z0-9_]{1,15})\)/.test(f.author || '')).map((f) => (f.author || '').match(/\(@([A-Za-z0-9_]{1,15})\)/)![1]);
    if (handles.length) {
      const learned = await getJSON<string[]>('x:authors', []);
      await setJSON('x:authors', Array.from(new Set([...handles, ...learned])).slice(0, 200)); // watched for free on every refresh
    }
    run.findIds = [...ids];
    run.total = ids.size;
    run.finds = newOnes.length;
    log(`saved ${run.total} relevant (${run.finds} new, ${run.total - run.finds} seen before)${oldDropped ? ` · ${oldDropped} old posts skipped (real post date from the link)` : ''}`);
    await purgeOldFinds().catch(() => null);

    if (opts.alert !== false && newOnes.length) {
      const hot = newOnes.filter((f) => f.kind !== 'company' && (f.confidence !== 'maybe' || f.kind === 'post')).slice(0, 15); // posts go stale fastest → always alert
      if (hot.length) {
        await sendAlert(
          hot.map((f) => ({ id: f.id, title: `${f.kind === 'post' ? '📣 ' : ''}${f.title}`, company: f.company || f.author || '', location: f.location || 'not stated', url: f.url, sources: [`agent:${f.mission}`], categories: f.role, domain: f.domain, seniority: 'mid' as const, hidden: true, locTags: f.locTags, score: 99, cvMatch: 0, firstSeen: now, lastSeen: now, description: f.snippet })),
          `Agent found ${hot.length} new opportunities (${mission?.title || 'your search'})`,
        ).catch(() => {});
      }
    }
  } catch (e) {
    run.error = (e as Error).message;
    log(`ERROR ${run.error}`);
  }
  run.ms = Date.now() - t0;
  const runs = await getJSON<AgentRun[]>('agent:runs', []);
  await setJSON('agent:runs', [run, ...runs].slice(0, 40));
  return run;
}

/** For cron: run the mission that ran least recently, within the daily search budget of your free tiers. */
export async function runDueMission(): Promise<AgentRun | { skipped: string }> {
  const interval = Number(process.env.AGENT_INTERVAL_MIN) || 120;
  const runs = await getJSON<AgentRun[]>('agent:runs', []);
  const last = runs.find((r) => r.mission !== 'custom');
  if (last && Date.now() - Date.parse(last.startedAt) < interval * 60000) return { skipped: `next mission due after ${interval} min` };
  await loadVault();
  if (!availableEngines().length) return { skipped: 'no web-search key configured' };
  const u = await searchUsage();
  if (u.usedToday >= u.dailyBudget) return { skipped: `daily search budget used (${u.usedToday}/${u.dailyBudget}) — protects your free monthly quota (${u.used}/${u.limit})` };
  const lastRunOf = (id: string) => Date.parse(runs.find((r) => r.mission === id)?.startedAt || '1970-01-01');
  // X + LinkedIn posts go stale fastest → every other slot is a posts mission
  const postsDue = ['x-posts', 'li-posts'].sort((a, b) => lastRunOf(a) - lastRunOf(b))[0];
  const other = MISSIONS.filter((m) => !['x-posts', 'li-posts'].includes(m.id)).sort((a, b) => lastRunOf(a.id) - lastRunOf(b.id))[0];
  const lastWasPosts = last && ['x-posts', 'li-posts'].includes(last.mission);
  const next = lastWasPosts ? other.id : postsDue;
  // posts: last 24 h only (freshest first); the other tabs keep their own window
  return runAgent({ missionId: next, budgetMs: 250000, depth: u.dailyBudget - u.usedToday > 25 ? 'deep' : 'quick', recency: ['x-posts', 'li-posts'].includes(next) ? 'day' : undefined });
}

/** Personal AI analysis of one job vs your CV. */
export async function fitAnalysis(job: { id: string; title: string; company: string; location: string; url: string; description?: string }) {
  const cache = await hgetall<any>('fit');
  if (cache[job.id]) return cache[job.id];
  await loadVault();
  const cv = await getCv();
  let jd = job.description || '';
  try {
    jd = (await readPage(job.url, 10000)) || jd;
  } catch {}
  const { data, meta } = await chatJson<any>(SYSTEM,
    `Compare this job with the candidate CV. Be brutally honest, no sugarcoating.\nJOB: ${job.title} at ${job.company} (${job.location})\nURL: ${job.url}\nJD:\n${jd.slice(0, 9000)}\n\nCV:\n${(cv.text || 'No CV uploaded. Skills: ' + cv.skills.join(', ')).slice(0, 7000)}\n\nJSON: {"fit_score":0-100,"verdict":"apply now|apply with referral|stretch|skip","why":"2-3 sentences","matching":["..."],"gaps":["..."],"fix_gaps_fast":["concrete 1-2 week actions"],"pitch":"3 bullet points to lead with","cold_dm":"<=300 chars LinkedIn/X DM to the hiring manager","cover_note":"<=120 words","red_flags":["..."],"india_eligible":"yes|no|unclear + reason"}`,
    { maxTokens: 1800 });
  const out = { ...(data || { why: meta.text.slice(0, 1500) }), _model: `${meta.provider} · ${meta.model}`, _at: new Date().toISOString() };
  await hset('fit', job.id, out);
  return out;
}
