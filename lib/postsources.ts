import { secret } from './secrets';
import { liveEngines, runEngine, webSearch, type Recency, type WebResult } from './search';
import { getJSON, setJSON } from './store';
import { createHash } from 'node:crypto';

/**
 * Find X / LinkedIn POSTS from every free door at once (jugaad stack):
 *  1. SearXNG (self-hosted, unlimited) — Google CSE / Yahoo / Yandex / Startpage / Mojeek behind it
 *  2. Bing RSS  (bing.com/search?format=rss — no key, no quota; strong on linkedin.com/posts)
 *  3. Linkup with includeDomains + fromDate (x.com / linkedin.com only — real tweets, ~4,000 free / month)
 *  4. the normal engine rotation (Exa, Firecrawl, Jina, Serper…) as a last resort
 * Results are only candidates: callers open every post at the source (X embed API, LinkedIn page) before showing it.
 */
export type Kind = 'x' | 'li';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const isPost = (k: Kind, u: string) => (k === 'x' ? /(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(u) : /linkedin\.com\/(posts|feed\/update)\//i.test(u));
const dec = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').trim();

async function bingRss(q: string, n = 30): Promise<WebResult[]> {
  try {
    const r = await fetch(`https://www.bing.com/search?format=rss&count=${n}&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const g = (t: string) => dec(m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] || '');
      return { title: g('title'), url: g('link'), snippet: g('description'), date: g('pubDate') ? new Date(g('pubDate')).toISOString() : null, engine: 'bing-rss' };
    }).filter((x) => x.url);
  } catch { return []; }
}

async function linkupDomain(q: string, kind: Kind, days: number): Promise<WebResult[]> {
  if (!secret('LINKUP_API_KEY')) return [];
  try {
    const r = await fetch('https://api.linkup.so/v1/search', {
      method: 'POST', headers: { Authorization: `Bearer ${secret('LINKUP_API_KEY')}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ q, depth: 'standard', outputType: 'searchResults', includeDomains: kind === 'x' ? ['x.com', 'twitter.com'] : ['linkedin.com'], fromDate: new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) }),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.results || []).map((x: { name?: string; url: string; content?: string }) => ({ title: x.name || '', url: x.url, snippet: x.content || '', engine: 'linkup' }));
  } catch { return []; }
}

/** Every door, in parallel, for one plain-English query. Linkup is cached 2 h per query to protect its free quota. */
export async function findPosts(kind: Kind, words: string, opts: { days?: number; place?: string } = {}): Promise<{ results: WebResult[]; doors: Record<string, number> }> {
  const days = opts.days ?? 7;
  const rec: Recency = days <= 1 ? 'day' : days <= 7 ? 'week' : 'month';
  const site = kind === 'x' ? 'site:x.com' : 'site:linkedin.com/posts';
  const w = words.trim();
  const place = opts.place ? ` ${opts.place}` : '';
  const live = (await liveEngines()).map((e) => e.id);
  const doors: Record<string, number> = {};
  const tally = (name: string, r: WebResult[]) => { const ok = r.filter((x) => isPost(kind, x.url)); doors[name] = (doors[name] || 0) + ok.length; return ok; };
  const lk = `pl:${kind}:${createHash('sha1').update(`${w}|${place}|${days}`).digest('hex').slice(0, 12)}`;
  const cachedLinkup = await getJSON<{ at: number; r: WebResult[] } | null>(lk, null);
  const jobs: Promise<WebResult[]>[] = [
    // 1. SearXNG — a few phrasings (free, unlimited)
    ...(live.includes('searxng') ? [`${site} ${w}${place}`, `${site} ${w} hiring${place}`, `${site} "${w}" (hiring OR "we're hiring" OR "join us" OR "DM me")`].map((q) => runEngine('searxng', q, 30, rec).then((r) => tally('searxng', r))) : []),
    // 2. Bing RSS — free; plain words work best (quotes make Bing drop the site: filter)
    bingRss(`${site} ${w.replace(/"/g, '')} hiring${place}`).then((r) => tally('bing', r)),
    ...(kind === 'li' ? [bingRss(`${site} ${w.replace(/"/g, '')}${place}`).then((r) => tally('bing', r))] : []),
    // 3. Linkup restricted to the platform + date
    (cachedLinkup && Date.now() - cachedLinkup.at < 2 * 36e5 ? Promise.resolve(cachedLinkup.r) : linkupDomain(`${w} hiring${place}`, kind, days).then(async (r) => { await setJSON(lk, { at: Date.now(), r }); return r; })).then((r) => tally('linkup', r)),
  ];
  const first = (await Promise.all(jobs)).flat();
  // 4. thin → the normal engine rotation too
  if (first.length < 8) for (const q of [`${site} ${w} hiring${place}`, `${site} ${w}`]) first.push(...tally('engines', (await webSearch(q, 20, rec).catch(() => ({ results: [] as WebResult[] }))).results));
  const seen = new Set<string>();
  const results = first.filter((r) => { const k = r.url.replace(/[?#].*$/, '').replace(/twitter\.com/, 'x.com').replace(/\/\/(www|mobile|[a-z]{2})\./, '//'); if (seen.has(k)) return false; seen.add(k); return true; });
  return { results, doors };
}
