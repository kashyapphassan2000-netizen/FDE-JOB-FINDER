import type { Category, CompanyEntry, Domain, RawJob } from './types';
import { classify, domainOf, hashId, isExcluded, locationAllowed, locationTags } from './classify';
import { atsFromUrl, probe } from './atsdetect';
import { availableEngines, readPage, webSearch, type WebResult } from './search';
import { aiConfigured, chatJson } from './llm';
import { getCv } from './cv';
import { getSettings } from './settings';
import { DEFAULT_COMPANIES } from './companies';
import { getJSON, hgetall, hset, setJSON } from './store';
import { loadVault } from './secrets';
import { pool } from './http';

/**
 * The job-hunting agent. Scope (your rule): ONLY FDE + AI/ML roles — in ANY company domain
 * (semiconductor, embedded, robotics, IT, fintech, health…). Places: Bengaluru, India, USA, remote-open-to-India.
 * Loop: plan queries → multi-engine web search (Google/LinkedIn posts/X posts/ATS boards/career pages)
 *       → detect company ATS boards in every link and verify them live → AI reads/filters the rest
 *       → deep-reads promising career pages → saves finds + discovered companies.
 */
export interface Mission { id: string; title: string; desc: string; queries: string[] }

const ROLE = '("forward deployed" OR "applied AI" OR "AI engineer" OR "ML engineer" OR "machine learning engineer" OR "LLM engineer" OR "GenAI engineer")';
export const MISSIONS: Mission[] = [
  { id: 'li-posts', title: 'LinkedIn hiring posts', desc: 'Founders / hiring managers posting FDE & AI roles (often not on job boards yet)',
    queries: [`site:linkedin.com/posts "forward deployed engineer" hiring (Bengaluru OR Bangalore OR India OR remote)`, `site:linkedin.com/posts "we are hiring" ("AI engineer" OR "ML engineer" OR "GenAI") Bengaluru`, `site:linkedin.com/posts hiring "applied AI" OR "founding AI engineer" India`] },
  { id: 'x-posts', title: 'X / Twitter hiring posts', desc: 'Hiring tweets from founders and AI teams',
    queries: [`site:x.com "forward deployed" hiring`, `site:x.com hiring ("AI engineer" OR "ML engineer") (Bangalore OR Bengaluru OR remote)`, `site:x.com "we're hiring" "founding engineer" AI remote`, `site:x.com hiring "applied AI" OR "GenAI engineer" Bengaluru`, `site:x.com "DM me" hiring "AI engineer" remote`] },
  { id: 'blr-hidden', title: 'Hidden Bengaluru AI startups', desc: 'Startup career boards (Ashby/Lever/Greenhouse/Workable) with Bengaluru FDE & AI roles',
    queries: [`site:jobs.ashbyhq.com (Bengaluru OR Bangalore) ${ROLE}`, `site:jobs.lever.co (Bengaluru OR Bangalore) ("AI" OR "machine learning" OR "forward deployed")`, `site:job-boards.greenhouse.io (Bengaluru OR Bangalore) ("AI engineer" OR "machine learning" OR "forward deployed")`, `site:apply.workable.com Bangalore ("AI engineer" OR "machine learning")`, `Bengaluru AI startup careers "founding" ("AI engineer" OR "forward deployed")`] },
  { id: 'remote-india', title: 'Remote roles open to India', desc: 'Worldwide / APAC remote FDE & AI roles Indians can take',
    queries: [`"forward deployed engineer" remote ("anywhere" OR "worldwide" OR "APAC" OR "India")`, `remote "AI engineer" ("work from anywhere" OR worldwide OR "remote - India") hiring`, `remote "machine learning engineer" "India" contract OR full-time AI startup`, `site:jobs.ashbyhq.com remote ("India" OR "APAC") ("AI" OR "forward deployed")`] },
  { id: 'global-remote', title: 'US / EU startups hiring remote worldwide', desc: 'Remote FDE & AI roles at foreign companies that hire from India (contract or full-time)',
    queries: [`"forward deployed engineer" remote "worldwide" OR "anywhere in the world"`, `site:jobs.ashbyhq.com remote ("anywhere" OR "worldwide" OR "global") ("AI engineer" OR "forward deployed")`, `"AI engineer" remote "hire from India" OR "contractors in India" OR "EOR" startup`, `site:jobs.lever.co remote worldwide ("applied AI" OR "machine learning engineer")`] },
  { id: 'domains', title: 'AI roles in semiconductor / embedded / robotics', desc: 'FDE & AI/ML roles at chip, edge-AI, robotics, automotive companies',
    queries: [`(Bengaluru OR Bangalore) ("edge AI" OR "on-device AI" OR "embedded AI") engineer hiring`, `(Bengaluru OR Bangalore) semiconductor "machine learning engineer" OR "AI engineer"`, `"ML compiler" OR "AI compiler" engineer Bengaluru hiring`, `robotics startup Bengaluru "AI engineer" OR "perception engineer" OR "forward deployed"`] },
  { id: 'new-startups', title: 'Newly funded AI startups hiring', desc: 'Recent seed / Series A AI startups (India + US) that are hiring',
    queries: [`AI startup raises seed OR "Series A" Bengaluru hiring engineers`, `"raised" "Series A" AI agents startup hiring "forward deployed"`, `YC AI startup India hiring "founding engineer"`] },
];

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
  engine: string;
  foundAt: string;
  status: 'new' | 'saved' | 'dismissed' | 'applied';
  ats?: { ats: CompanyEntry['ats']; slug: string; total: number; relevant: number };
}

export interface AgentRun {
  id: string; mission: string; prompt?: string; startedAt: string; ms: number; queries: string[];
  engines: string[]; ai: string | null; log: string[]; finds: number; companies: number; error?: string;
}

const SYSTEM = `You are a sharp job-hunting agent for Karthik (Bengaluru, India; ~3 yrs automotive embedded → moving into AI engineering).
Target roles ONLY: Forward Deployed Engineer (incl. applied AI engineer/architect, AI solutions/deployment engineer) and AI/ML roles (ML engineer, AI engineer, LLM/GenAI engineer, MLOps, applied scientist, edge/embedded AI).
ANY company domain is fine (semiconductor, embedded, robotics, automotive, IT/SaaS, fintech, health…). Reject non-AI roles (pure firmware, RTL, sales, HR, marketing) and job seekers' own "open to work" posts.
LOCATION RULE (strict): the ONLY office he can attend is Bengaluru. Everything else must be REMOTE and open to people living in India (worldwide / APAC / India remote). Reject onsite or hybrid roles in any other city or country, and remote roles restricted to US/EU/UK/Canada residents.`;

const watchedKeys = (extra: CompanyEntry[]) => new Set([...DEFAULT_COMPANIES, ...extra].map((c) => `${c.ats}:${c.slug}`.toLowerCase()));

function heuristic(r: WebResult): Partial<Find> | null {
  const text = `${r.title} ${r.snippet}`;
  const role = classify({ title: r.title, company: '', location: '', url: r.url, description: r.snippet });
  const roleFromSnippet = classify({ title: r.snippet.slice(0, 200), company: '', location: '', url: r.url });
  const roles = Array.from(new Set([...role, ...roleFromSnippet]));
  if (!roles.length) return null;
  const isPost = /linkedin\.com\/(posts|feed)|x\.com|twitter\.com|reddit\.com/.test(r.url);
  if (isPost && !/hiring|we're hiring|we are hiring|join (us|our)|open role|looking for/i.test(text)) return null;
  return { kind: isPost ? 'post' : 'job', title: r.title.slice(0, 200), role: roles, why: 'keyword match (add an AI provider for smarter filtering)' };
}

export async function runAgent(opts: { missionId?: string; prompt?: string; budgetMs?: number }): Promise<AgentRun> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 240000;
  const left = () => budget - (Date.now() - t0);
  await loadVault();
  const settings = await getSettings();
  const mission = MISSIONS.find((m) => m.id === opts.missionId);
  const run: AgentRun = { id: `r${Date.now().toString(36)}`, mission: mission?.id || 'custom', prompt: opts.prompt, startedAt: new Date().toISOString(), ms: 0, queries: [], engines: availableEngines().map((e) => e.id), ai: null, log: [], finds: 0, companies: 0 };
  const log = (s: string) => run.log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
  const hasAI = await aiConfigured();

  try {
    if (!run.engines.length) throw new Error('No web-search engine configured. Add a free Tavily / Firecrawl / Exa / Linkup / Serper key (or your SearXNG URL) in "AI & Keys".');

    // 1. PLAN
    let queries = mission?.queries || [];
    if (opts.prompt) {
      if (hasAI) {
        try {
          const { data, meta } = await chatJson<{ queries: string[] }>(SYSTEM,
            `Turn this request into 6 precise web-search queries (Google syntax: quotes, OR, site:). Mix: company career boards (site:jobs.ashbyhq.com, site:jobs.lever.co, site:job-boards.greenhouse.io, site:apply.workable.com), LinkedIn hiring posts (site:linkedin.com/posts), X posts (site:x.com) and general web.\nRequest: ${opts.prompt}\nJSON: {"queries":["..."]}`, { maxTokens: 600 });
          run.ai = `${meta.provider} · ${meta.model}`;
          if (data?.queries?.length) queries = data.queries.slice(0, 7);
          log(`planned ${queries.length} queries with ${run.ai}`);
        } catch (e) {
          log(`AI planning failed (${(e as Error).message.slice(0, 120)}) → using keyword plan`);
        }
      }
      if (!queries.length) queries = [opts.prompt, `${opts.prompt} site:linkedin.com/posts hiring`, `${opts.prompt} site:x.com hiring`, `${opts.prompt} (site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:job-boards.greenhouse.io)`];
    }
    run.queries = queries;

    // 2. SEARCH
    const seen = new Set<string>();
    const results: WebResult[] = [];
    const sres = await pool(queries, 3, (q) => webSearch(q, 10));
    sres.forEach((r, i) => {
      if (r.status !== 'fulfilled') return log(`search failed: ${queries[i]}`);
      r.value.errors.forEach((e) => log(`engine error ${e}`));
      for (const x of r.value.results) {
        const k = x.url.split('#')[0].replace(/\?.*$/, '');
        if (!seen.has(k)) { seen.add(k); results.push(x); }
      }
    });
    log(`search: ${results.length} unique results from ${queries.length} queries`);

    const finds: Find[] = [];
    const now = new Date().toISOString();
    const mk = (r: WebResult, f: Partial<Find>): Find => {
      const loc = f.location || '';
      const raw: RawJob = { title: f.title || r.title, company: f.company || '', location: loc, url: r.url, description: r.snippet };
      return {
        id: hashId(r.url), kind: f.kind || 'job', title: (f.title || r.title).slice(0, 220), company: (f.company || '').slice(0, 100), location: loc.slice(0, 120),
        url: r.url, snippet: r.snippet.slice(0, 500), why: (f.why || '').slice(0, 300), role: f.role?.length ? f.role : classify(raw),
        domain: f.domain || domainOf(raw), locTags: f.locTags || locationTags({ ...raw, location: `${loc} ${r.snippet.slice(0, 160)}` }),
        mission: run.mission, engine: r.engine, foundAt: now, status: 'new', ats: f.ats,
      };
    };

    // 3. ATS BOARDS — verify live, add as companies + relevant jobs
    const watched = watchedKeys(settings.extraCompanies);
    const boards = new Map<string, { ats: CompanyEntry['ats']; slug: string; r: WebResult }>();
    for (const r of results) {
      const a = atsFromUrl(r.url);
      if (a && !boards.has(`${a.ats}:${a.slug}`.toLowerCase())) boards.set(`${a.ats}:${a.slug}`.toLowerCase(), { ...a, r });
    }
    const toProbe = [...boards.entries()].filter(([k]) => !watched.has(k)).slice(0, 20);
    const probed = await pool(toProbe, 6, async ([, b]) => ({ b, d: await probe(b.ats, b.slug, b.slug) }));
    for (const p of probed) {
      if (p.status !== 'fulfilled' || !p.value.d) continue;
      const { b, d } = p.value;
      const rel = d.jobs.filter((j) => classify(j).length && locationAllowed(locationTags(j), j.location));
      const company = d.jobs[0]?.company && d.jobs[0].company !== b.slug ? d.jobs[0].company : b.slug;
      finds.push(mk({ ...b.r, url: b.r.url }, { kind: 'company', title: `${b.slug} — ${rel.length} FDE/AI roles open (${d.total} total) on ${b.ats}`, company, why: 'Company career board found in search results and verified live. Click "Watch" to pull its jobs every refresh.', ats: { ats: b.ats, slug: b.slug, total: d.total, relevant: rel.length } }));
      for (const j of rel.slice(0, 8)) finds.push(mk({ title: j.title, url: j.url, snippet: j.description || '', engine: `ats:${b.ats}` }, { kind: 'job', title: j.title, company: b.slug, location: j.location, why: `Open on ${b.ats} board (verified)` }));
    }
    run.companies = finds.filter((f) => f.kind === 'company').length;
    log(`ATS boards: ${boards.size} seen, ${toProbe.length} new probed, ${run.companies} verified`);

    // 4. FILTER the rest (AI if configured, else keywords)
    const rest = results.filter((r) => !atsFromUrl(r.url) || !boards.has(`${atsFromUrl(r.url)!.ats}:${atsFromUrl(r.url)!.slug}`.toLowerCase()) || /\/(jobs?|j)\/|[0-9a-f-]{20,}/.test(r.url));
    const careerPages: WebResult[] = [];
    if (hasAI && left() > 60000) {
      const batch = rest.slice(0, 45).map((r, i) => ({ i, title: r.title, url: r.url, snippet: r.snippet.slice(0, 300) }));
      try {
        const { data, meta } = await chatJson<{ items: { i: number; relevant: boolean; kind: Find['kind']; title: string; company: string; location: string; role: string[]; domain: Domain; why: string }[] }>(SYSTEM,
          `Classify these web results. Keep only real FDE or AI/ML job postings, real hiring posts by companies/founders, or company careers pages likely listing such roles.\nResults:\n${JSON.stringify(batch)}\nJSON: {"items":[{"i":0,"relevant":true,"kind":"job|post|careers_page","title":"clean role title","company":"","location":"city/country/remote scope","role":["FDE"|"AIML"],"domain":"AI_LAB|AI_INFRA|SEMI|EMBEDDED|IT|FINTECH|HEALTH|DEFENSE|CONSULTING|OTHER","why":"max 20 words"}]}`,
          { maxTokens: 3500, timeoutMs: Math.min(90000, left() - 20000) });
        run.ai = `${meta.provider} · ${meta.model}`;
        for (const it of data?.items || []) {
          const r = batch[it.i] && rest[it.i];
          if (!r || !it.relevant) continue;
          if (it.kind === 'careers_page') careerPages.push(r);
          finds.push(mk(r, { kind: it.kind || 'job', title: it.title, company: it.company, location: it.location, role: (it.role || []).filter((x) => x === 'FDE' || x === 'AIML') as Category[], domain: it.domain, why: it.why }));
        }
        log(`AI filtered ${batch.length} results → ${(data?.items || []).filter((x) => x.relevant).length} relevant (${run.ai})`);
      } catch (e) {
        log(`AI filtering failed (${(e as Error).message.slice(0, 140)}) → keyword filter`);
        for (const r of rest) { const h = heuristic(r); if (h) finds.push(mk(r, h)); }
      }
    } else {
      for (const r of rest) { const h = heuristic(r); if (h) finds.push(mk(r, h)); }
      log(`keyword filter → ${finds.filter((f) => f.kind !== 'company').length} candidates${hasAI ? '' : ' (no AI provider set)'}`);
    }

    // 5. DEEP READ promising careers pages (AI only) — "open the company website and list roles"
    if (hasAI && careerPages.length && left() > 70000) {
      const pages = careerPages.slice(0, 3);
      const read = await pool(pages, 3, async (p) => ({ p, text: await readPage(p.url, 9000) }));
      for (const x of read) {
        if (x.status !== 'fulfilled' || left() < 30000) continue;
        try {
          const { data } = await chatJson<{ jobs: { title: string; location: string; url: string }[]; company: string }>(SYSTEM,
            `From this careers page, list ONLY FDE / AI-ML roles with their location and absolute apply URL (use the page URL if none).\nPage URL: ${x.value.p.url}\n---\n${x.value.text}\n---\nJSON: {"company":"","jobs":[{"title":"","location":"","url":""}]}`, { maxTokens: 1500, timeoutMs: Math.min(60000, left() - 15000) });
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

    // 6. SAVE (keep your status on finds you already triaged)
    const existing = await hgetall<Find>('agent:finds');
    let fresh = 0;
    for (const f of finds) {
      const prev = existing[f.id];
      if (prev) continue;
      if (f.kind !== 'company' && !f.role.length) continue;
      if (f.kind === 'job' && !locationAllowed(f.locTags, f.location)) continue; // onsite outside Bengaluru / remote not open to India
      if (f.kind !== 'company' && isExcluded({ title: f.title, company: f.company, location: f.location, url: f.url }, settings)) continue;
      await hset('agent:finds', f.id, f);
      fresh++;
    }
    run.finds = fresh;
    log(`saved ${fresh} new finds`);
  } catch (e) {
    run.error = (e as Error).message;
    log(`ERROR ${run.error}`);
  }
  run.ms = Date.now() - t0;
  const runs = await getJSON<AgentRun[]>('agent:runs', []);
  await setJSON('agent:runs', [run, ...runs].slice(0, 40));
  return run;
}

/** For cron: run the mission that ran least recently, if the interval has passed. */
export async function runDueMission(): Promise<AgentRun | { skipped: string }> {
  const interval = Number(process.env.AGENT_INTERVAL_MIN) || 180;
  const runs = await getJSON<AgentRun[]>('agent:runs', []);
  const last = runs.find((r) => r.mission !== 'custom');
  if (last && Date.now() - Date.parse(last.startedAt) < interval * 60000) return { skipped: `next mission due after ${interval} min` };
  await loadVault();
  if (!availableEngines().length) return { skipped: 'no web-search key configured' };
  const lastRunOf = (id: string) => Date.parse(runs.find((r) => r.mission === id)?.startedAt || '1970-01-01');
  const next = [...MISSIONS].sort((a, b) => lastRunOf(a.id) - lastRunOf(b.id))[0];
  return runAgent({ missionId: next.id, budgetMs: 250000 });
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
