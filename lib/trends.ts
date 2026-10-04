import type { Job } from './types';
import { DOMAIN_LABEL, extractSkills } from './classify';
import { getCv } from './cv';
import { aiConfigured, chatJson } from './llm';
import { getJobs } from './refresh';
import { webSearch, type WebResult } from './search';
import { getJSON, hgetall, setJSON } from './store';
import { loadVault } from './secrets';
import { pool } from './http';
import type { Find } from './agent';

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
  const finds = Object.values(findsH).filter((f) => f.kind === 'job' || f.kind === 'post');
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
    if (co && !/listing|unstop|internshala|telegram|mercor$/i.test(co)) { inc(companies, co); companyDomain.set(co, DOMAIN_LABEL[r.domain as keyof typeof DOMAIN_LABEL] || r.domain); }
    inc(regions, r.region);
    inc(domains, DOMAIN_LABEL[r.domain as keyof typeof DOMAIN_LABEL] || 'Other');
    const fam = roleFamily(r.title);
    inc(roles, fam);
    if (r.fresh) inc(rolesNew, fam);
    const sk = extractSkills(r.text).filter((s) => !['production', 'solutions', 'deployment', 'evaluation', 'rest', 'go'].includes(s));
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
  at: string; model?: string;
  headlines: { title: string; summary: string; region: string; url: string }[];
  hot_skills: { skill: string; why: string; region: string }[];
  new_roles: { role: string; what: string; who_hires: string }[];
  domains: { domain: string; ai_use_cases: string; companies: string; your_angle: string }[];
  your_moves: string[];
  sources: { title: string; url: string }[];
}

const NEWS_QUERIES = [
  'AI hiring trends India 2026 skills in demand', 'AI engineer jobs demand USA 2026 new skills', 'forward deployed engineer demand 2026 companies hiring',
  'new AI job roles 2026', 'GenAI agentic AI skills most in demand employers', 'Bengaluru AI startups hiring news this week',
  'AI layoffs hiring freeze 2026 tech', 'global AI talent demand report 2026 LinkedIn Indeed',
];

/** AI market report from fresh web/news results (≈8 searches, cached; refresh when you want). */
export async function buildMarketReport(): Promise<MarketReport> {
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const res = await pool(NEWS_QUERIES, 4, (q) => webSearch(q, 8, 'month'));
  const hits: WebResult[] = [];
  const seen = new Set<string>();
  for (const r of res) if (r.status === 'fulfilled') for (const x of r.value.results) if (!seen.has(x.url)) { seen.add(x.url); hits.push(x); }
  if (!hits.length) throw new Error('No news results — check your web-search keys in AI & Keys');
  const [cv, t] = await Promise.all([getCv(), computeTrends()]);
  const list = hits.slice(0, 45).map((h, i) => `${i}. ${h.title} | ${h.url} | ${h.snippet.slice(0, 280).replace(/\s+/g, ' ')}`).join('\n');
  const { data, meta } = await chatJson<Omit<MarketReport, 'at' | 'sources'>>(
    'You are a sharp AI-jobs market analyst. Use ONLY the provided search results and job statistics; never invent numbers or companies. Be concrete and brief.',
    `FRESH SEARCH RESULTS:\n${list}\n\nOUR JOB DATA (${t.total} jobs/posts): top skills ${t.skills.slice(0, 15).map((s) => `${s.key}(${s.n})`).join(', ')}; roles ${t.roles.slice(0, 10).map((r) => `${r.key}(${r.n})`).join(', ')}; domains ${t.domains.map((d) => `${d.key}(${d.n})`).join(', ')}.
CANDIDATE: Bengaluru-based, moving into AI engineering (FDE / AI-ML). CV skills: ${cv.skills.join(', ') || 'not uploaded'}.
JSON: {"headlines":[{"title":"","summary":"1-2 sentences","region":"India|USA|Global","url":"from the results"}],"hot_skills":[{"skill":"","why":"","region":"India|USA|Global"}],"new_roles":[{"role":"","what":"","who_hires":""}],"domains":[{"domain":"","ai_use_cases":"where AI solutions are being deployed","companies":"examples from results/data","your_angle":"how this candidate maps his skills to it"}],"your_moves":["3-6 concrete actions for the next 2 weeks"]}
Give 6-10 headlines, 8-12 hot skills, 4-8 new roles, 5-8 domains.`,
    { maxTokens: 4000, timeoutMs: 120000 },
  );
  if (!data) throw new Error('AI returned no report, try again');
  const report: MarketReport = { at: new Date().toISOString(), model: `${meta.provider} · ${meta.model}`, headlines: data.headlines || [], hot_skills: data.hot_skills || [], new_roles: data.new_roles || [], domains: data.domains || [], your_moves: data.your_moves || [], sources: hits.slice(0, 45).map((h) => ({ title: h.title, url: h.url })) };
  await setJSON('trends:report', report);
  return report;
}
