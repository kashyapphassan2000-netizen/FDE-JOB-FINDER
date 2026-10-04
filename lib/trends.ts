import type { Job } from './types';
import { DOMAIN_LABEL, extractSkills, locationAllowed, locationTags } from './classify';
import { getCv } from './cv';
import { aiConfigured, chatJson, listOf } from './llm';
import { getJobs } from './refresh';
import { newsSearch, readArticles, type NewsItem } from './news';
import { getJSON, hgetall, setJSON } from './store';
import { loadVault } from './secrets';
import { pool } from './http';
import { isFreshFind, type Find } from './agent';

/**
 * Trends = what the market is asking for, computed from every job + hiring post the app has collected,
 * plus daily snapshots (to see what is RISING) and an AI market report built from fresh news/web searches.
 */
type Count = { key: string; n: number };
export interface Snapshot { date: string; total: number; skills: Record<string, number>; roles: Record<string, number> }

const top = (m: Map<string, number>, k = 25): Count[] => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([key, n]) => ({ key, n }));
const inc = (m: Map<string, number>, k: string, by = 1) => k && m.set(k, (m.get(k) || 0) + by);

/** "Senior Staff Forward Deployed Engineer, Agents (Remote)" → "Forward Deployed Engineer" */
export function roleFamily(title: string): string {
  const t = title.toLowerCase();
  const rules: [RegExp, string][] = [
    [/forward[\s-]?deploy/, 'Forward Deployed Engineer'], [/deployment (engineer|strategist|lead)/, 'AI Deployment Engineer / Strategist'],
    [/solutions? (engineer|architect)/, 'AI Solutions Engineer / Architect'], [/applied (ai|ml|scientist)/, 'Applied AI / Applied Scientist'],
    [/founding (ai |ml )?engineer/, 'Founding Engineer'], [/agent|agentic/, 'AI Agent Engineer'], [/llm|genai|gen ai|generative/, 'LLM / GenAI Engineer'],
    [/mlops|ml ops|ml platform|ml infra|ai infra|inference|serving/, 'MLOps / ML Platform / Inference'], [/eval|red team|safety|alignment/, 'AI Evals / Safety'],
    [/research (engineer|scientist)|member of technical staff|\bmts\b/, 'Research Engineer / Scientist'], [/data scien/, 'Data Scientist'],
    [/computer vision|perception|\bcv\b/, 'Computer Vision / Perception'], [/robot|autonom|edge ai|embedded ai|on-device/, 'Robotics / Edge AI'],
    [/speech|voice|audio|asr|tts/, 'Speech / Voice AI'], [/product manager|\bpm\b/, 'AI Product Manager'], [/machine learning|\bml\b/, 'ML Engineer'], [/\bai\b/, 'AI Engineer'],
  ];
  for (const [rx, name] of rules) if (rx.test(t)) return name;
  return 'Other AI role';
}

const regionOf = (j: { locTags: string[] }) => (j.locTags.includes('BLR') ? 'Bengaluru' : j.locTags.includes('REMOTE_IN') ? 'Remote (India OK)' : j.locTags.includes('INDIA') ? 'India (other)' : j.locTags.includes('USA') ? 'USA' : 'Not stated');

export async function computeTrends() {
  const [jobs, findsH, cv] = await Promise.all([getJobs(), hgetall<Find>('agent:finds'), getCv()]);
  const finds = Object.values(findsH).filter((f) => (f.kind === 'job' || f.kind === 'post') && f.status !== 'dismissed' && isFreshFind(f)).map((f) => ({ ...f, locTags: locationTags({ title: f.title, company: f.company, location: f.location, url: f.url }) })).filter((f) => !f.location || locationAllowed(f.locTags, f.location));
  type Row = { title: string; company: string; text: string; domain: string; region: string; when: string; fresh: boolean };
  const rows: Row[] = [
    ...jobs.map((j: Job) => ({ title: j.title, company: j.company, text: `${j.title} ${j.description || ''}`, domain: j.domain, region: regionOf(j), when: j.postedAt || j.firstSeen, fresh: Date.now() - Date.parse(j.firstSeen) < 7 * 864e5 })),
    ...finds.map((f) => ({ title: f.title, company: f.company, text: `${f.title} ${f.snippet || ''}`, domain: f.domain, region: regionOf(f), when: f.postedAt || f.foundAt, fresh: Date.now() - Date.parse(f.foundAt) < 7 * 864e5 })),
  ];
  const companies = new Map<string, number>(), regions = new Map<string, number>(), domains = new Map<string, number>(), roles = new Map<string, number>(), skills = new Map<string, number>();
  const skillsByDomain = new Map<string, Map<string, number>>(), skillsByRegion = new Map<string, Map<string, number>>(), rolesNew = new Map<string, number>();
  const companyDomain = new Map<string, string>();
  for (const r of rows) {
    const co = (r.company || '').replace(/\s*\(@.*$/, '').replace(/ via mercor| on x$/i, '').trim();
    if (co && !/listing|unstop|internshala|telegram|mercor$|jobgether|reddit|r\/|hacker news|remotive|remote ?ok|himalayas|jobicy|working nomads|we work remotely|nodesk|themuse|the muse|80,000|linkedin|instahyre|naukri|foundit|indeed|glassdoor|wellfound|capture/i.test(co)) { inc(companies, co); companyDomain.set(co, DOMAIN_LABEL[r.domain as keyof typeof DOMAIN_LABEL] || r.domain); }
    inc(regions, r.region);
    inc(domains, DOMAIN_LABEL[r.domain as keyof typeof DOMAIN_LABEL] || 'Other');
    const fam = roleFamily(r.title);
    inc(roles, fam);
    if (r.fresh) inc(rolesNew, fam);
    const sk = extractSkills(r.text).filter((s) => !['production', 'solutions', 'deployment', 'evaluation', 'customer-facing', 'stakeholder', 'consulting'].includes(s));
    for (const s of sk) {
      inc(skills, s);
      const dl = DOMAIN_LABEL[r.domain as keyof typeof DOMAIN_LABEL] || 'Other';
      if (!skillsByDomain.has(dl)) skillsByDomain.set(dl, new Map());
      inc(skillsByDomain.get(dl)!, s);
      if (!skillsByRegion.has(r.region)) skillsByRegion.set(r.region, new Map());
      inc(skillsByRegion.get(r.region)!, s);
    }
  }
  // rising vs ~7 days ago
  const snaps = await getJSON<Snapshot[]>('trends:snaps', []);
  const old = snaps.find((s) => Date.now() - Date.parse(s.date) >= 6 * 864e5) || null;
  const share = (n: number, total: number) => (total ? n / total : 0);
  const rising = old
    ? top(skills, 60).map((c) => ({ ...c, change: Math.round((share(c.n, rows.length) - share(old.skills[c.key] || 0, old.total)) * 1000) / 10 })).filter((c) => c.change > 0.3).sort((a, b) => b.change - a.change).slice(0, 12)
    : [];
  const newRoles = old ? top(roles, 40).filter((c) => !(c.key in old.roles)).slice(0, 10) : [];
  const cvSet = new Set(cv.skills);
  const demanded = top(skills, 30);
  return {
    total: rows.length, jobs: jobs.length, posts: finds.length, since: snaps.length ? snaps[snaps.length - 1].date : null, history: snaps.length,
    regions: top(regions, 8), domains: top(domains, 12), roles: top(roles, 18), rolesThisWeek: top(rolesNew, 10),
    companies: top(companies, 30).map((c) => ({ ...c, domain: companyDomain.get(c.key) || '' })),
    skills: demanded, rising, newRoles,
    skillsByDomain: [...skillsByDomain.entries()].map(([d, m]) => ({ domain: d, skills: top(m, 8) })).sort((a, b) => b.skills.reduce((x, y) => x + y.n, 0) - a.skills.reduce((x, y) => x + y.n, 0)).slice(0, 8),
    skillsByRegion: [...skillsByRegion.entries()].map(([r, m]) => ({ region: r, skills: top(m, 8) })),
    yourSkills: { have: demanded.filter((s) => cvSet.has(s.key)).map((s) => s.key), missing: demanded.filter((s) => !cvSet.has(s.key)).slice(0, 12).map((s) => s.key), cvUploaded: cv.skills.length > 0 },
  };
}

/** Called after every refresh: one snapshot per day (history for "rising skills" and "new roles"). */
export async function saveTrendSnapshot(jobs: Job[]) {
  const date = new Date().toISOString().slice(0, 10);
  const skills: Record<string, number> = {}, roles: Record<string, number> = {};
  for (const j of jobs) {
    for (const s of extractSkills(`${j.title} ${j.description || ''}`)) skills[s] = (skills[s] || 0) + 1;
    const f = roleFamily(j.title);
    roles[f] = (roles[f] || 0) + 1;
  }
  const snaps = (await getJSON<Snapshot[]>('trends:snaps', [])).filter((s) => s.date !== date);
  await setJSON('trends:snaps', [{ date, total: jobs.length, skills, roles }, ...snaps].slice(0, 60));
}

export interface MarketReport {
  at: string; model?: string; days?: number; articles?: number; news?: number;
  summary?: string;
  headlines: { title: string; summary: string; region: string; url: string; date?: string; source?: string }[];
  hot_skills: { skill: string; why: string; region: string; url?: string }[];
  new_roles: { role: string; what: string; who_hires: string; url?: string }[];
  domains: { domain: string; ai_use_cases: string; companies: string; your_angle: string }[];
  who_hiring?: { company: string; what: string; region: string; url?: string }[];
  watch_out?: string[];
  your_moves: string[];
  sources: { title: string; url: string; date?: string; source?: string }[];
}

const NEWS_QUERIES = [
  'AI hiring India skills in demand', 'AI engineer jobs demand', 'forward deployed engineer', 'new AI job roles', 'agentic AI skills employers',
  'Bengaluru AI startups hiring', 'GenAI jobs India report', 'AI talent demand report', 'AI engineer salary India', 'LLM engineer hiring',
  'AI hiring freeze layoffs tech', 'enterprise AI adoption deployment engineers',
];

type Fact = { fact: string; kind: 'skill' | 'role' | 'domain' | 'hiring' | 'layoff' | 'salary' | 'other'; region: string; company?: string; i: number };

/** Deep market report: dated news (last 7 days) → full articles read → facts extracted per article batch → synthesis with citations. */
export async function buildMarketReport(days = 7): Promise<MarketReport> {
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const { items, errors } = await newsSearch(NEWS_QUERIES, days, { perQuery: 8 });
  if (!items.length) throw new Error(`No news in the last ${days} days — ${errors[0] || 'news feeds unreachable'}`);
  const pick = items.slice(0, 50);
  await readArticles(pick, 18, 3000);
  const full = pick.filter((x) => x.text), thin = pick.filter((x) => !x.text).slice(0, 20);
  // pass 1: facts
  const batches: NewsItem[][] = [];
  for (let i = 0; i < full.length; i += 5) batches.push(full.slice(i, i + 5));
  if (thin.length) batches.push(thin);
  const facts: (Fact & { url: string; date: string; source: string })[] = [];
  let model = '';
  await pool(batches, 2, async (b) => {
    const list = b.map((h, i) => `[${i}] ${h.title} | ${h.source} | ${(h.date || '').slice(0, 10)}\n${(h.text || h.snippet).replace(/\s+/g, ' ').slice(0, h.text ? 2600 : 280)}`).join('\n\n');
    try {
      const { data, meta } = await chatJson<{ facts: Fact[] }>('Extract concrete, checkable facts about the AI / tech JOB MARKET from these articles: skills in demand, new roles, domains deploying AI, who is hiring (with numbers/city), layoffs, salaries. Numbers and names only from the text. Skip fluff.',
        `ARTICLES:\n${list}\nJSON: {"facts":[{"fact":"1 sentence with the number/name","kind":"skill|role|domain|hiring|layoff|salary|other","region":"India|USA|Global|Bengaluru|Europe","company":"if any","i":<article index>}]}`, { maxTokens: 2500, timeoutMs: 90000 });
      model = `${meta.provider} · ${meta.model}`;
      for (const f of listOf<Fact>(data, 'facts')) if (f.fact && b[f.i]) facts.push({ ...f, url: b[f.i].url, date: (b[f.i].date || '').slice(0, 10), source: b[f.i].source });
    } catch {}
  });
  if (!facts.length) throw new Error('Could not extract facts from the news (AI quota?) — try again in a minute');
  // pass 2: synthesis
  const [cv, t] = await Promise.all([getCv(), computeTrends()]);
  const factList = facts.slice(0, 120).map((f, i) => `F${i} [${f.kind}|${f.region}|${f.date}] ${f.fact}${f.company ? ` (${f.company})` : ''}`).join('\n');
  type F = { f?: number };
  const { data, meta } = await chatJson<{ summary?: string; headlines?: (MarketReport['headlines'][number] & F)[]; hot_skills?: (MarketReport['hot_skills'][number] & F)[]; new_roles?: (MarketReport['new_roles'][number] & F)[]; domains?: MarketReport['domains']; who_hiring?: (NonNullable<MarketReport['who_hiring']>[number] & F)[]; watch_out?: string[]; your_moves?: string[] }>(
    'You are an elite AI-jobs market analyst writing for one candidate. Use ONLY the numbered facts and the job statistics; never invent numbers or companies. Cite facts with their F-number in "f". Be concrete, specific and brief.',
    `FACTS (news, last ${days} days):\n${factList}\n\nOUR LIVE JOB DATA (${t.total} jobs/posts): top skills ${t.skills.slice(0, 15).map((s) => `${s.key}(${s.n})`).join(', ')}; roles ${t.roles.slice(0, 10).map((r) => `${r.key}(${r.n})`).join(', ')}; domains ${t.domains.map((d) => `${d.key}(${d.n})`).join(', ')}; rising ${t.rising.map((r) => r.key).join(', ') || 'n/a'}.
CANDIDATE: Bengaluru-based, moving into AI engineering (FDE / AI-ML). Works only Bengaluru office or remote-from-India. CV skills: ${cv.skills.join(', ') || 'not uploaded'}.
JSON: {"summary":"4-5 sentence state of the market this week","headlines":[{"title":"","summary":"1-2 sentences","region":"India|USA|Global","f":0}],"hot_skills":[{"skill":"","why":"evidence","region":"India|USA|Global","f":0}],"new_roles":[{"role":"","what":"","who_hires":"","f":0}],"domains":[{"domain":"","ai_use_cases":"","companies":"","your_angle":"how this candidate maps his skills to it"}],"who_hiring":[{"company":"","what":"","region":"","f":0}],"watch_out":["risks: layoffs, freezes, saturated roles"],"your_moves":["5-8 concrete actions for the next 2 weeks"]}
Give 8-12 headlines, 8-12 hot skills, 4-8 new roles, 5-8 domains, 6-15 companies hiring.`,
    { maxTokens: 5000, timeoutMs: 150000 },
  );
  if (!data) throw new Error('AI returned no report, try again');
  const cite = (f?: number) => (typeof f === 'number' && facts[f] ? facts[f] : undefined);
  const report: MarketReport = {
    at: new Date().toISOString(), model: `${meta.provider} · ${meta.model}${model && model !== `${meta.provider} · ${meta.model}` ? ` + ${model}` : ''}`, days, articles: full.length, news: items.length, summary: (data.summary || '').replace(/\s*[[(]F\d+(?:\s*[,;]\s*F?\d+)*[\])]/gi, ''),
    headlines: (data.headlines || []).map((h) => ({ title: h.title, summary: h.summary, region: h.region, url: cite(h.f)?.url || h.url || '', date: cite(h.f)?.date, source: cite(h.f)?.source })),
    hot_skills: (data.hot_skills || []).map((h) => ({ skill: h.skill, why: h.why, region: h.region, url: cite(h.f)?.url })),
    new_roles: (data.new_roles || []).map((h) => ({ role: h.role, what: h.what, who_hires: h.who_hires, url: cite(h.f)?.url })),
    domains: data.domains || [],
    who_hiring: (data.who_hiring || []).map((h) => ({ company: h.company, what: h.what, region: h.region, url: cite(h.f)?.url })),
    watch_out: data.watch_out || [], your_moves: data.your_moves || [],
    sources: pick.filter((x) => x.text).concat(thin).slice(0, 60).map((h) => ({ title: h.title, url: h.url, date: (h.date || '').slice(0, 10), source: h.source })),
  };
  await setJSON('trends:report', report);
  return report;
}
