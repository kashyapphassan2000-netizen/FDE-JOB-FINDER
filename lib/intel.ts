import { aiConfigured, chatJson } from './llm';
import { webSearch, type WebResult } from './search';
import { getJobs } from './refresh';
import { getJSON, hgetall, hset, setJSON } from './store';
import { loadVault } from './secrets';
import { pool } from './http';
import type { DiscoveredCompany } from './discover';
import type { TrackEntry } from './types';

/**
 * Company intel registry — grows with every scan. Two signal types:
 *   hiring  : who is LIKELY to hire FDE / AI-ML people in the coming months (funding, new India/Bengaluru office or GCC,
 *             announced hiring plans, posting momentum in your own job data)
 *   layoffs : who is cutting jobs, why, and what they say they will do next
 * Every signal keeps its evidence link. Nothing is predicted without a source; "forecast" = AI reading of public news.
 */
export interface HiringSignal { signal: string; roles: string; region: string; timeframe: string; confidence: 'high' | 'medium' | 'low'; url: string; date: string; kind: 'news' | 'funding' | 'postings' }
export interface LayoffSignal { date: string; count: string; reason: string; next: string; region: string; url: string; aiRelated: boolean }
export interface CompanyIntel { key: string; name: string; domain?: string; hiring: HiringSignal[]; layoffs: LayoffSignal[]; openRoles?: number; newRoles7d?: number; updatedAt: string }

export const keyOf = (n: string) => n.toLowerCase().replace(/\b(inc|ltd|llc|pvt|private|limited|technologies|labs|corp|corporation|ai)\b/g, '').replace(/[^a-z0-9]/g, '');

const HIRING_QUERIES = [
  'company plans to hire AI engineers India 2026', 'opens new office Bengaluru AI hiring 2026', 'new GCC Bengaluru launch 2026 AI engineers hiring',
  'AI startup raises Series A hiring engineers India', 'AI startup raises funding to expand team remote engineers', 'forward deployed engineers hiring expansion 2026',
  'to hire thousands AI talent India next year', 'expands India R&D centre AI hiring', 'YC startup India hiring founding engineer 2026', 'Anthropic OpenAI Google India expansion hiring 2026',
];
const LAYOFF_QUERIES = [
  'tech layoffs this week', 'layoffs India tech companies 2026', 'AI layoffs restructuring 2026 company cuts jobs', 'startup layoffs India 2026',
  'big tech layoffs 2026 reason', 'layoffs replaced by AI 2026', 'IT services layoffs India 2026', 'company cuts workforce to focus on AI 2026',
];

async function gather(queries: string[]): Promise<WebResult[]> {
  const res = await pool(queries, 4, (q) => webSearch(q, 10, 'month'));
  const seen = new Set<string>();
  const out: WebResult[] = [];
  for (const r of res) if (r.status === 'fulfilled') for (const x of r.value.results) if (!seen.has(x.url)) { seen.add(x.url); out.push(x); }
  return out;
}

async function upsert(name: string, patch: (c: CompanyIntel) => void) {
  const key = keyOf(name);
  if (!key || key.length < 2) return;
  const cur = (await hgetall<CompanyIntel>('intel:co'))[key] || { key, name, hiring: [], layoffs: [], updatedAt: '' };
  patch(cur);
  cur.updatedAt = new Date().toISOString();
  await hset('intel:co', key, cur);
}

export async function scanIntel(kind: 'hiring' | 'layoffs'): Promise<{ kind: string; found: number; companies: string[]; ai?: string }> {
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const hits = await gather(kind === 'hiring' ? HIRING_QUERIES : LAYOFF_QUERIES);
  if (!hits.length) throw new Error('No news results — check web-search keys in AI & Keys');
  const batches: WebResult[][] = [];
  for (let i = 0; i < hits.length; i += 20) batches.push(hits.slice(i, i + 20));
  const names: string[] = [];
  let ai = '';
  await pool(batches, 2, async (b) => {
    const list = b.map((h, i) => `${i}. ${h.title} | ${h.url} | ${h.date || ''} | ${h.snippet.slice(0, 300).replace(/\s+/g, ' ')}`).join('\n');
    if (kind === 'hiring') {
      const { data, meta } = await chatJson<{ items: { company: string; signal: string; roles: string; region: string; timeframe: string; confidence: 'high' | 'medium' | 'low'; i: number; date: string }[] }>(
        'Extract companies that are LIKELY TO HIRE engineers (especially AI/ML, LLM, forward deployed / solutions engineers) in the coming months, based only on the evidence in these results: funding rounds, new offices/GCCs (esp. Bengaluru/India), announced hiring plans, expansion. One item per company per piece of evidence. Never invent; skip results without a concrete company.',
        `RESULTS:\n${list}\nJSON: {"items":[{"company":"","signal":"what happened, 1 sentence","roles":"which roles they will likely hire","region":"Bengaluru|India|Remote/Global|USA|Europe|...","timeframe":"e.g. next 1-3 months","confidence":"high|medium|low","i":<result index>,"date":"YYYY-MM or as stated"}]}`,
        { maxTokens: 3000, timeoutMs: 90000 },
      );
      ai = `${meta.provider} · ${meta.model}`;
      for (const it of data?.items || []) {
        if (!it.company || !b[it.i]) continue;
        names.push(it.company);
        await upsert(it.company, (c) => {
          if (!c.hiring.some((h) => h.url === b[it.i].url)) c.hiring.unshift({ signal: it.signal, roles: it.roles, region: it.region, timeframe: it.timeframe, confidence: it.confidence || 'medium', url: b[it.i].url, date: it.date || (b[it.i].date || '').slice(0, 10), kind: 'news' });
          c.hiring = c.hiring.slice(0, 10);
        });
      }
    } else {
      const { data, meta } = await chatJson<{ items: { company: string; date: string; count: string; reason: string; next: string; region: string; ai_related: boolean; i: number }[] }>(
        'Extract layoffs / job cuts from these results. One item per company per event. Only use what the result says; "next" = what the company says it will do next (e.g. refocus on AI, restructure, close unit) or "not stated".',
        `RESULTS:\n${list}\nJSON: {"items":[{"company":"","date":"YYYY-MM or as stated","count":"number or % as stated","reason":"","next":"","region":"India|USA|Global|...","ai_related":true,"i":<result index>}]}`,
        { maxTokens: 3000, timeoutMs: 90000 },
      );
      ai = `${meta.provider} · ${meta.model}`;
      for (const it of data?.items || []) {
        if (!it.company || !b[it.i]) continue;
        names.push(it.company);
        await upsert(it.company, (c) => {
          if (!c.layoffs.some((l) => l.url === b[it.i].url)) c.layoffs.unshift({ date: it.date, count: it.count, reason: it.reason, next: it.next, region: it.region, url: b[it.i].url, aiRelated: Boolean(it.ai_related) });
          c.layoffs = c.layoffs.slice(0, 10);
        });
      }
    }
  });
  await setJSON(`intel:meta:${kind}`, { at: new Date().toISOString(), found: names.length, ai });
  return { kind, found: names.length, companies: Array.from(new Set(names)).slice(0, 50), ai };
}

/** Registry + signals derived from your own data (posting momentum, freshly funded startups, your tracker exposure). */
export async function getIntel() {
  const [co, jobs, disc, track, mh, ml] = await Promise.all([
    hgetall<CompanyIntel>('intel:co'), getJobs(), getJSON<DiscoveredCompany[]>('disc:companies', []), hgetall<TrackEntry>('track'),
    getJSON<{ at: string } | null>('intel:meta:hiring', null), getJSON<{ at: string } | null>('intel:meta:layoffs', null),
  ]);
  const all = { ...co };
  // posting momentum: companies opening many FDE/AI roles right now (from your job list)
  const per = new Map<string, { name: string; open: number; week: number }>();
  for (const j of jobs) {
    const k = keyOf(j.company);
    if (!k || /listing|unstop|internshala|telegram|reddit|on x$|via mercor/i.test(j.company)) continue;
    const e = per.get(k) || { name: j.company, open: 0, week: 0 };
    e.open++;
    if (Date.now() - Date.parse(j.firstSeen) < 7 * 864e5) e.week++;
    per.set(k, e);
  }
  for (const [k, e] of per) {
    const c = all[k] || { key: k, name: e.name, hiring: [], layoffs: [], updatedAt: '' };
    c.openRoles = e.open;
    c.newRoles7d = e.week;
    if (e.week >= 3 && !c.hiring.some((h) => h.kind === 'postings')) c.hiring = [{ signal: `${e.week} new FDE/AI roles in your feed this week (${e.open} open)`, roles: 'FDE / AI-ML', region: 'from your job list', timeframe: 'hiring now', confidence: 'high', url: '', date: new Date().toISOString().slice(0, 10), kind: 'postings' }, ...c.hiring];
    all[k] = c;
  }
  // freshly funded startups (Excel: Series A/B → hiring in 2-8 weeks)
  for (const d of (Array.isArray(disc) ? disc : Object.values(disc as Record<string, DiscoveredCompany>)).filter((x) => x.fundedAt && Date.now() - Date.parse(x.fundedAt) < 60 * 864e5)) {
    const k = keyOf(d.name);
    const c = all[k] || { key: k, name: d.name, hiring: [], layoffs: [], updatedAt: '' };
    if (!c.hiring.some((h) => h.kind === 'funding')) c.hiring.push({ signal: d.fundingNews || 'Recently funded', roles: 'engineers incl. AI (typically within 2-8 weeks of a round)', region: d.region.join(', ') || 'n/a', timeframe: 'next 1-2 months', confidence: 'medium', url: d.sourceUrl || d.website || '', date: (d.fundedAt || '').slice(0, 10), kind: 'funding' });
    all[k] = c;
  }
  const list = Object.values(all);
  const tracked = new Set(Object.values(track).map((t) => keyOf(t.job.company)));
  const hiring = list.filter((c) => c.hiring.length).sort((a, b) => score(b) - score(a));
  const layoffs = list.filter((c) => c.layoffs.length).sort((a, b) => (b.layoffs[0]?.date || '').localeCompare(a.layoffs[0]?.date || '')).map((c) => ({ ...c, inYourTracker: tracked.has(c.key), openInYourFeed: c.openRoles || 0 }));
  return { hiring, layoffs, companies: list.length, hiringScanned: mh?.at || null, layoffsScanned: ml?.at || null };
}

function score(c: CompanyIntel) {
  const conf = { high: 3, medium: 2, low: 1 } as const;
  return c.hiring.reduce((s, h) => s + conf[h.confidence || 'low'] + (/bengaluru|bangalore|india|remote|global/i.test(h.region) ? 2 : 0), 0) + (c.newRoles7d || 0) * 2 - c.layoffs.length * 2;
}
