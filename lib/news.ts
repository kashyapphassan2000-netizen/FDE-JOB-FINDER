import { decodeEntities, getText, parseRss, pool, stripHtml } from './http';
import { readPage, webSearch } from './search';

/**
 * Fresh, dated news for the research sheets (Trends report, Hiring radar, Layoffs, Hidden startups).
 * Free and keyless: Google News RSS (date-filtered with when:Nd) + Bing News RSS. Every item has a real publish date,
 * so old stories can be dropped. Full articles are read (Jina reader) instead of relying on snippets.
 * Falls back to the paid web-search engines (last week) only if both feeds fail.
 */
export interface NewsItem { title: string; url: string; source: string; date: string | null; snippet: string; text?: string }

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
const normTitle = (t: string) => t.toLowerCase().replace(/\s+-\s+[^-]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);

async function googleNews(q: string, days: number, region: 'IN' | 'US'): Promise<NewsItem[]> {
  const ceid = region === 'IN' ? 'hl=en-IN&gl=IN&ceid=IN:en' : 'hl=en-US&gl=US&ceid=US:en';
  const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&${ceid}`, { timeoutMs: 15000, headers: UA });
  return parseRss(xml).map((i) => {
    const m = i.title.match(/\s+-\s+([^-]+)$/);
    return { title: m ? i.title.slice(0, m.index) : i.title, url: i.link, source: m ? m[1].trim() : 'Google News', date: i.pubDate, snippet: stripHtml(i.description, 300) };
  });
}

async function bingNews(q: string, days: number): Promise<NewsItem[]> {
  const iv = days <= 1 ? '4' : days <= 7 ? '7' : '8';
  const xml = await getText(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=interval%3d%22${iv}%22&setlang=en`, { timeoutMs: 15000, headers: UA });
  const srcs = [...xml.matchAll(/<News:Source>([^<]*)<\/News:Source>/g)].map((m) => decodeEntities(m[1]));
  return parseRss(xml).map((i, k) => {
    let url = i.link;
    try { const u = new URL(i.link); url = u.searchParams.get('url') || i.link; } catch {}
    return { title: i.title, url, source: srcs[k] || 'Bing News', date: i.pubDate, snippet: i.description.slice(0, 300) };
  });
}

/** Many queries → merged, de-duplicated, only items published in the last `days` days, newest first. */
export async function newsSearch(queries: string[], days = 7, opts: { regions?: ('IN' | 'US')[]; perQuery?: number } = {}): Promise<{ items: NewsItem[]; errors: string[] }> {
  const regions = opts.regions || ['IN', 'US'];
  const tasks: (() => Promise<NewsItem[]>)[] = [];
  for (const q of queries) {
    for (const r of regions) tasks.push(() => googleNews(q, days, r));
    tasks.push(() => bingNews(q, days));
  }
  const res = await pool(tasks, 6, (f) => f());
  const errors: string[] = [];
  const seen = new Set<string>();
  const cutoff = Date.now() - days * 864e5 - 12 * 36e5;
  const items: NewsItem[] = [];
  const per = opts.perQuery || 12;
  res.forEach((r) => {
    if (r.status !== 'fulfilled') return void errors.push(String((r.reason as Error)?.message || r.reason).slice(0, 100));
    for (const it of r.value.slice(0, per)) {
      const k = normTitle(it.title);
      if (!k || seen.has(k)) continue;
      if (it.date && Date.parse(it.date) < cutoff) continue; // OLD → dropped
      seen.add(k);
      items.push(it);
    }
  });
  if (!items.length) {
    // both free feeds failed (blocked / down) → paid search engines, last week only
    const w = await pool(queries.slice(0, 6), 3, (q) => webSearch(q, 8, days <= 1 ? 'day' : 'week'));
    for (const r of w) if (r.status === 'fulfilled') for (const x of r.value.results) {
      const k = normTitle(x.title);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ title: x.title, url: x.url, source: new URL(x.url).hostname.replace(/^www\./, ''), date: x.date || null, snippet: x.snippet.slice(0, 300) });
    }
  }
  items.sort((a, b) => Date.parse(b.date || '1970') - Date.parse(a.date || '1970'));
  return { items, errors };
}

/** news.google.com/rss/articles/… → the publisher URL (Google's own decode endpoint; 2 small requests). */
export async function resolveGoogleNews(url: string): Promise<string> {
  if (!/news\.google\.com\/rss\/articles\//.test(url)) return url;
  const id = url.split('/articles/')[1].split('?')[0];
  const html = await getText(`https://news.google.com/rss/articles/${id}`, { timeoutMs: 12000, headers: UA });
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  if (!ts || !sg) return url;
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const body = `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]))}`;
  const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body, signal: AbortSignal.timeout(12000) });
  const t = await r.text();
  const m = t.match(/garturlres\\",\\"(https?:[^\\"]+)/);
  return m ? m[1] : url;
}

/** Read the full text of the top N articles (falls back to the snippet when a site blocks readers). */
export async function readArticles(items: NewsItem[], n = 12, chars = 5000): Promise<NewsItem[]> {
  const top = items.slice(0, n);
  await pool(top, 4, async (it) => {
    try {
      it.url = await resolveGoogleNews(it.url).catch(() => it.url);
      if (/news\.google\.com|instagram\.com|youtube\.com|x\.com|twitter\.com|facebook\.com/.test(it.url)) return;
      const txt = (await readPage(it.url, chars + 3000)).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\n{3,}/g, '\n\n');
      // keep the part that mentions the headline's first words (skips nav/cookie junk)
      const start = Math.max(0, txt.toLowerCase().indexOf(it.title.toLowerCase().split(/\s+/).slice(0, 3).join(' ')));
      const body = txt.slice(start, start + chars).trim();
      if (body.length > 400) it.text = body;
    } catch {}
  });
  return items;
}

export const daysAgo = (iso?: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null);
