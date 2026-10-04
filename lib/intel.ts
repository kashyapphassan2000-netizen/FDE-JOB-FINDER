import { aiConfigured, chatJson, listOf } from './llm';
import { newsSearch, readArticles, resolveGoogleNews, type NewsItem } from './news';
import { getJobs } from './refresh';
import { getJSON, hdel, hgetall, hset, setJSON } from './store';
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
export interface HiringSignal { signal: string; roles: string; region: string; timeframe: string; confidence: 'high' | 'medium' | 'low'; url: string; date: string; kind: 'news' | 'funding' | 'postings'; source?: string; seenAt?: string }
export interface LayoffSignal { date: string; count: string; reason: string; next: string; region: string; url: string; aiRelated: boolean; teams?: string; forYou?: string; source?: string; seenAt?: string }
export interface CompanyIntel { key: string; name: string; domain?: string; hiring: HiringSignal[]; layoffs: LayoffSignal[]; openRoles?: number; newRoles7d?: number; updatedAt: string }
export interface IntelMeta { at: string; found: number; ai: string; brief?: string; articles?: number; news?: number; days?: number; errors?: string[] }

export const keyOf = (n: string) => n.toLowerCase().replace(/\b(inc|ltd|llc|pvt|private|limited|technologies|labs|corp|corporation|ai)\b/g, '').replace(/[^a-z0-9]/g, '');

/** Freshness rule: anything older than this is purged from the sheets. */
export const FRESH_DAYS = { hiring: 45, layoffs: 60 } as const;

const Y = () => new Date().getFullYear();
const HIRING_QUERIES = () => [
  'plans to hire AI engineers India', 'new office Bengaluru hiring engineers', 'GCC Bengaluru launch AI hiring', 'global capability centre India AI jobs',
  'AI startup raises Series A hiring', 'AI startup raises funding expand engineering team', 'forward deployed engineers hiring', 'to hire AI talent India',
  'expands India R&D centre AI', `YC startup India founding engineer ${Y()}`, 'OpenAI Anthropic India expansion hiring', 'AI company hiring spree engineers',
];
const LAYOFF_QUERIES = () => [
  'tech layoffs', 'layoffs India tech company', 'layoffs AI restructuring', 'startup layoffs India', 'big tech layoffs reason', 'layoffs replaced by AI',
  'IT services layoffs India', 'company cuts workforce focus on AI', 'job cuts software engineers', 'layoffs Bengaluru employees',
];

/** Parse "2026-09-12", "2026-09", ISO, or RFC dates → ms (NaN if unknown). */
export function whenMs(d?: string | null): number {
  if (!d) return NaN;
  const t = /^\d{4}-\d{2}$/.test(d) ? Date.parse(`${d}-15`) : /^\d{4}-\d{2}-\d{2}|^[A-Z][a-z]{2}, \d/.test(d) ? Date.parse(d) : NaN;
  return t > Date.now() + 2 * 864e5 ? NaN : t; // free text ("by 2030") or future → unknown
}
const freshEnough = (d: string | undefined, seen: string | undefined, days: number) => {
  const t = whenMs(d);
  const ref = Number.isNaN(t) ? whenMs(seen) : t;
  return !Number.isNaN(ref) && Date.now() - ref < days * 864e5;
};

async function upsertMany(patches: { name: string; patch: (c: CompanyIntel) => void }[]) {
  const all = await hgetall<CompanyIntel>('intel:co');
  const touched = new Map<string, CompanyIntel>();
  for (const { name, patch } of patches) {
    const key = keyOf(name);
    if (!key || key.length < 2) continue;
    const cur = touched.get(key) || all[key] || { key, name, hiring: [], layoffs: [], updatedAt: '' };
    patch(cur);
    cur.updatedAt = new Date().toISOString();
    touched.set(key, cur);
  }
  await pool([...touched.values()], 8, (c) => hset('intel:co', c.key, c));
}

/** Remove signals older than the freshness window; drop companies left with nothing. */
export async function purgeIntel(): Promise<{ removed: number; companiesDropped: number }> {
  const all = await hgetall<CompanyIntel>('intel:co');
  let removed = 0, companiesDropped = 0;
  await pool(Object.values(all), 8, async (c) => {
    const h = c.hiring.filter((x) => x.kind !== 'postings' && freshEnough(x.date, x.seenAt, FRESH_DAYS.hiring));
    const l = c.layoffs.filter((x) => freshEnough(x.date, x.seenAt, FRESH_DAYS.layoffs));
    const diff = c.hiring.length - h.length + c.layoffs.length - l.length;
    if (!diff) return;
    removed += diff;
    if (!h.length && !l.length) { companiesDropped++; await hdel('intel:co', c.key); return; }
    await hset('intel:co', c.key, { ...c, hiring: h, layoffs: l });
  });
  return { removed, companiesDropped };
}

/**
 * Deep, fresh scan: dated news from the last `days` days (Google News + Bing News, free) → read the full articles →
 * AI extraction with each item's real publish date → old signals purged. One brief summary per scan.
 */
export async function scanIntel(kind: 'hiring' | 'layoffs', days = 7): Promise<{ kind: string; found: number; companies: string[]; ai?: string; articles: number; news: number; purged: number }> {
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const { items, errors } = await newsSearch(kind === 'hiring' ? HIRING_QUERIES() : LAYOFF_QUERIES(), days, { perQuery: 10 });
  if (!items.length) throw new Error(`No news in the last ${days} days — ${errors[0] || 'news feeds unreachable'}`);
  const pick = items.slice(0, 60);
  await readArticles(pick, 30, 3000);
  const articles = pick.filter((x) => x.text).length;
  // full-text items in small batches, snippet-only items in bigger ones (keeps free-tier token limits happy)
  const full = pick.filter((x) => x.text), thin = pick.filter((x) => !x.text);
  const batches: NewsItem[][] = [];
  for (let i = 0; i < full.length; i += 4) batches.push(full.slice(i, i + 4));
  for (let i = 0; i < thin.length; i += 12) batches.push(thin.slice(i, i + 12));
  const names: string[] = [];
  const patches: { name: string; patch: (c: CompanyIntel) => void }[] = [];
  const seenAt = new Date().toISOString();
  const briefLines: string[] = [];
  const usedItems = new Set<NewsItem>();
  let ai = '';
  await pool(batches, 3, async (b) => {
    const thinB = !b[0]?.text;
    const how = thinB ? ' These are HEADLINES with short snippets only: extract EVERY company the headline names (several per headline is fine); use only what the headline states and write "see article" for unknown fields.' : '';
    const list = b.map((h, i) => `[${i}] ${h.title} | ${h.source} | published ${(h.date || 'unknown').slice(0, 10)}\n${(h.text || h.snippet).replace(/\s+/g, ' ').slice(0, h.text ? 2800 : 300)}`).join('\n\n');
    try {
      if (kind === 'hiring') {
        const { data, meta } = await chatJson<{ items: { company: string; signal: string; roles: string; region: string; timeframe: string; confidence: 'high' | 'medium' | 'low'; i: number }[] }>(
          'You are a hiring-intelligence analyst. From these NEWS ARTICLES extract companies LIKELY TO HIRE engineers (especially AI/ML, LLM, forward deployed / solutions engineers) in the coming months: funding rounds, new offices / GCCs (esp. Bengaluru/India), announced hiring numbers, expansions, new AI teams. Use concrete facts from the article (amounts, headcount, city, team). One item per company per article. Never invent; skip articles without a concrete company or a hiring implication.' + how,
          `ARTICLES:\n${list}\nJSON: {"items":[{"company":"","signal":"what happened + key numbers, 1-2 sentences","roles":"which roles they will likely hire","region":"Bengaluru|India|Remote/Global|USA|Europe|...","timeframe":"e.g. next 1-3 months","confidence":"high|medium|low","i":<article index>}]}`,
          { maxTokens: 3000, timeoutMs: 90000 },
        );
        ai = `${meta.provider} · ${meta.model}`;
        for (const it of listOf<any>(data, 'items')) {
          const src = b[it.i];
          if (!it.company || !src) continue;
          names.push(it.company);
          usedItems.add(src);
          briefLines.push(`- ${it.company}: ${it.signal} (${it.region}, ${(src.date || '').slice(0, 10)})`);
          patches.push({ name: it.company, patch: (c) => {
            if (c.hiring.some((h) => h.url === src.url)) return;
            c.hiring.unshift({ signal: it.signal, roles: it.roles, region: it.region, timeframe: it.timeframe, confidence: it.confidence || 'medium', url: src.url, date: (src.date || seenAt).slice(0, 10), kind: 'news', source: src.source, seenAt });
            c.hiring = c.hiring.sort((x, y) => (whenMs(y.date) || 0) - (whenMs(x.date) || 0)).slice(0, 10);
          } });
        }
      } else {
        const { data, meta } = await chatJson<{ items: { company: string; count: string; reason: string; next: string; teams: string; region: string; ai_related: boolean; for_you: string; i: number }[] }>(
          'You are a labour-market analyst. From these NEWS ARTICLES extract layoffs / job cuts. One item per company per event. Read the article text: give the real stated REASON (cost, AI automation, restructuring, demand, merger…), WHICH teams/roles were hit, and what the company says it will do NEXT (e.g. invest in AI, close a unit, move work to India, rehire for AI). Write "not stated in article" only when the article truly does not say. Trackers/round-ups: one item per company listed. Skip non-tech consumer brands only if no tech/engineering roles are involved. Never invent.' + how,
          `ARTICLES:\n${list}\nJSON: {"items":[{"company":"","count":"number or % as stated","reason":"","teams":"teams/roles affected","next":"","region":"India|USA|Global|...","ai_related":true,"for_you":"1 line: what this means for an FDE / AI engineer job seeker (e.g. they are rebuilding around AI → pitch; or avoid)","i":<article index>}]}`,
          { maxTokens: 3000, timeoutMs: 90000 },
        );
        ai = `${meta.provider} · ${meta.model}`;
        for (const it of listOf<any>(data, 'items')) {
          const src = b[it.i];
          if (!it.company || !src) continue;
          names.push(it.company);
          usedItems.add(src);
          briefLines.push(`- ${it.company}: ${it.count} cut; reason: ${it.reason}; next: ${it.next} (${it.region}, ${(src.date || '').slice(0, 10)})`);
          patches.push({ name: it.company, patch: (c) => {
            if (c.layoffs.some((l) => l.url === src.url)) return;
            c.layoffs.unshift({ date: (src.date || seenAt).slice(0, 10), count: it.count, reason: it.reason, next: it.next, teams: it.teams, forYou: it.for_you, region: it.region, url: src.url, aiRelated: Boolean(it.ai_related), source: src.source, seenAt });
            c.layoffs = c.layoffs.sort((x, y) => (whenMs(y.date) || 0) - (whenMs(x.date) || 0)).slice(0, 10);
          } });
        }
      }
    } catch (e) {
      errors.push((e as Error).message.slice(0, 120));
    }
  });
  // cited Google News links → real publisher URLs
  const cited = [...usedItems].filter((x) => /news\.google\.com/.test(x.url));
  await pool(cited, 4, async (x) => { x.url = await resolveGoogleNews(x.url).catch(() => x.url); });
  await upsertMany(patches);
  const { removed } = await purgeIntel();
  // one-paragraph brief of the week (from the extracted facts only)
  let brief = '';
  if (patches.length) {
    try {
      const facts = briefLines.slice(0, 25).join('\n');
      const { data } = await chatJson<{ brief: string }>('Write a sharp 3-4 sentence brief for a Bengaluru-based FDE / AI engineer job seeker. Only use the facts given; do not generalise beyond them. No fluff.',
        `${kind === 'hiring' ? 'Hiring / expansion / funding' : 'Layoff'} facts from the last ${days} days:\n${facts}\nJSON: {"brief":""}`, { maxTokens: 600, timeoutMs: 45000 });
      brief = data?.brief || '';
    } catch {}
  }
  const meta: IntelMeta = { at: new Date().toISOString(), found: names.length, ai, brief, articles, news: items.length, days, errors: errors.slice(0, 5) };
  await setJSON(`intel:meta:${kind}`, meta);
  return { kind, found: names.length, companies: Array.from(new Set(names)).slice(0, 50), ai, articles, news: items.length, purged: removed };
}

/** Registry + signals derived from your own data (posting momentum, freshly funded startups, your tracker exposure). */
export async function getIntel() {
  const [co, jobs, disc, track, mh, ml] = await Promise.all([
    hgetall<CompanyIntel>('intel:co'), getJobs(), getJSON<DiscoveredCompany[]>('disc:companies', []), hgetall<TrackEntry>('track'),
    getJSON<IntelMeta | null>('intel:meta:hiring', null), getJSON<IntelMeta | null>('intel:meta:layoffs', null),
  ]);
  // never show stale signals, even before the next purge
  const all: Record<string, CompanyIntel> = {};
  for (const [k, c] of Object.entries(co)) {
    const hiring = c.hiring.filter((x) => x.kind !== 'postings' && freshEnough(x.date, x.seenAt, FRESH_DAYS.hiring));
    const layoffs = c.layoffs.filter((x) => freshEnough(x.date, x.seenAt, FRESH_DAYS.layoffs));
    if (hiring.length || layoffs.length) all[k] = { ...c, hiring, layoffs };
  }
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
  for (const d of (Array.isArray(disc) ? disc : Object.values(disc as Record<string, DiscoveredCompany>)).filter((x) => x.fundedAt && Date.now() - Date.parse(x.fundedAt) < FRESH_DAYS.hiring * 864e5)) {
    const k = keyOf(d.name);
    const c = all[k] || { key: k, name: d.name, hiring: [], layoffs: [], updatedAt: '' };
    if (!c.hiring.some((h) => h.kind === 'funding')) c.hiring.push({ signal: d.fundingNews || 'Recently funded', roles: 'engineers incl. AI (typically within 2-8 weeks of a round)', region: d.region.join(', ') || 'n/a', timeframe: 'next 1-2 months', confidence: 'medium', url: d.sourceUrl || d.website || '', date: (d.fundedAt || '').slice(0, 10), kind: 'funding' });
    all[k] = c;
  }
  const list = Object.values(all);
  const tracked = new Set(Object.values(track).map((t) => keyOf(t.job.company)));
  const hiring = list.filter((c) => c.hiring.length).sort((a, b) => score(b) - score(a)).map((c) => ({ ...c, latest: c.hiring.reduce((m, h) => Math.max(m, whenMs(h.date) || 0), 0) }));
  const layoffs = list.filter((c) => c.layoffs.length).sort((a, b) => (whenMs(b.layoffs[0]?.date) || 0) - (whenMs(a.layoffs[0]?.date) || 0)).map((c) => ({ ...c, inYourTracker: tracked.has(c.key), openInYourFeed: c.openRoles || 0 }));
  return { hiring, layoffs, companies: list.length, hiringScanned: mh?.at || null, layoffsScanned: ml?.at || null, hiringMeta: mh, layoffsMeta: ml, freshDays: FRESH_DAYS };
}

function score(c: CompanyIntel) {
  const conf = { high: 3, medium: 2, low: 1 } as const;
  return c.hiring.reduce((s, h) => { const age = (Date.now() - (whenMs(h.date) || Date.now())) / 864e5; return s + conf[h.confidence || 'low'] + (/bengaluru|bangalore|india|remote|global/i.test(h.region) ? 2 : 0) + (age < 7 ? 3 : age < 21 ? 1 : 0); }, 0) + (c.newRoles7d || 0) * 2 - c.layoffs.length * 2;
}
