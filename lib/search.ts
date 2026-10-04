import { secret } from './secrets';
import { getJSON, hgetall, hincr, setJSON } from './store';
import { stripHtml } from './http';

/**
 * Web search for the AI agent. Uses whichever engines you have keys for and ROTATES between them,
 * so several free tiers stack (Tavily 1k/mo + Firecrawl 1k/mo + Exa + Linkup + Serper 2.5k + SerpApi 250 …).
 * A self-hosted SearXNG URL gives truly unlimited searches.
 */
export interface WebResult { title: string; url: string; snippet: string; date?: string | null; engine: string }

/** How fresh results must be: 'any' = no date filter (people/company lookups). */
export type Recency = 'day' | 'week' | 'month' | 'any';
type Engine = { id: string; label: string; needs: string; freeMonthly: number; run: (q: string, n: number, recent: Recency) => Promise<WebResult[]> };

async function j(url: string, init: RequestInit, timeoutMs = 25000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const text = await r.text();
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

const since = (r: Recency) => new Date(Date.now() - ({ day: 1.2, week: 8, month: 32, any: 3650 }[r]) * 864e5).toISOString().slice(0, 10);

export const ENGINES: Engine[] = [
  {
    id: 'searxng', freeMonthly: 999999, label: 'SearXNG (self-hosted, unlimited)', needs: 'SEARXNG_URL',
    run: async (q, n, recent) => {
      const d = await j(`${secret('SEARXNG_URL').replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}&format=json${recent !== 'any' ? `&time_range=${recent}` : ''}`, { method: 'GET' });
      return (d.results || []).slice(0, n).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || '', date: r.publishedDate || null, engine: 'searxng' }));
    },
  },
  {
    id: 'tavily', freeMonthly: 1000, label: 'Tavily', needs: 'TAVILY_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.tavily.com/search', { method: 'POST', headers: { Authorization: `Bearer ${secret('TAVILY_API_KEY')}` }, body: JSON.stringify({ query: q, max_results: Math.min(n, 20), search_depth: 'basic', ...(recent !== 'any' ? { time_range: recent } : {}) }) });
      return (d.results || []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || '', date: r.published_date || null, engine: 'tavily' }));
    },
  },
  {
    id: 'firecrawl', freeMonthly: 500, label: 'Firecrawl', needs: 'FIRECRAWL_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.firecrawl.dev/v2/search', { method: 'POST', headers: { Authorization: `Bearer ${secret('FIRECRAWL_API_KEY')}` }, body: JSON.stringify({ query: q, limit: n, ...(recent !== 'any' ? { tbs: `qdr:${recent[0]}` } : {}) }) });
      const arr = Array.isArray(d.data) ? d.data : d.data?.web || [];
      return arr.map((r: any) => ({ title: r.title || r.metadata?.title || '', url: r.url, snippet: r.description || '', engine: 'firecrawl' }));
    },
  },
  {
    id: 'exa', freeMonthly: 1000, label: 'Exa', needs: 'EXA_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.exa.ai/search', { method: 'POST', headers: { 'x-api-key': secret('EXA_API_KEY') }, body: JSON.stringify({ query: q, numResults: n, type: 'auto', ...(recent !== 'any' ? { startPublishedDate: since(recent) } : {}), contents: { highlights: { maxCharacters: 400 } } }) });
      return (d.results || []).map((r: any) => ({ title: r.title || '', url: r.url, snippet: (r.highlights || []).join(' ') || r.text || '', date: r.publishedDate || null, engine: 'exa' }));
    },
  },
  {
    id: 'linkup', freeMonthly: 1000, label: 'Linkup', needs: 'LINKUP_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.linkup.so/v1/search', { method: 'POST', headers: { Authorization: `Bearer ${secret('LINKUP_API_KEY')}` }, body: JSON.stringify({ q, depth: 'standard', outputType: 'searchResults' }) });
      return (d.results || []).slice(0, n).map((r: any) => ({ title: r.name || '', url: r.url, snippet: r.content || '', engine: 'linkup' }));
    },
  },
  {
    id: 'serper', freeMonthly: 2500, label: 'Serper (Google)', needs: 'SERPER_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': secret('SERPER_API_KEY') }, body: JSON.stringify({ q, num: n, ...(recent !== 'any' ? { tbs: `qdr:${recent[0]}` } : {}) }) });
      return (d.organic || []).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet || '', date: r.date || null, engine: 'serper' }));
    },
  },
  {
    id: 'brave', freeMonthly: 2000, label: 'Brave', needs: 'BRAVE_API_KEY',
    run: async (q, n, recent) => {
      const d = await j(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.min(n, 20)}${recent !== 'any' ? `&freshness=p${recent[0]}` : ''}`, { method: 'GET', headers: { 'X-Subscription-Token': secret('BRAVE_API_KEY'), Accept: 'application/json' } });
      return (d.web?.results || []).map((r: any) => ({ title: stripHtml(r.title, 200), url: r.url, snippet: stripHtml(r.description || '', 400), date: r.age || null, engine: 'brave' }));
    },
  },
  {
    id: 'jina', freeMonthly: 1000, label: 'Jina search', needs: 'JINA_API_KEY',
    run: async (q, n, recent) => {
      const d = await j(`https://s.jina.ai/?q=${encodeURIComponent(q)}`, { method: 'GET', headers: { Authorization: `Bearer ${secret('JINA_API_KEY')}`, Accept: 'application/json', 'X-Respond-With': 'no-content' } }, 40000);
      return (d.data || []).slice(0, n).map((r: any) => ({ title: r.title || '', url: r.url, snippet: r.description || '', date: r.date || null, engine: 'jina' }));
    },
  },
  {
    id: 'serpapi', freeMonthly: 250, label: 'SerpApi (Google)', needs: 'SERPAPI_KEY',
    run: async (q, n, recent) => {
      const d = await j(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&num=${n}${recent !== 'any' ? `&tbs=qdr:${recent[0]}` : ''}&api_key=${secret('SERPAPI_KEY')}`, { method: 'GET' });
      return (d.organic_results || []).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet || '', date: r.date || null, engine: 'serpapi' }));
    },
  },
];

export function availableEngines(): Engine[] {
  return ENGINES.filter((e) => Boolean(secret(e.needs)));
}

const month = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

async function count(engine: string) {
  await Promise.all([hincr(`search:usage:${month()}`, engine), hincr(`search:day:${today()}`, engine)]);
}

/** Searches used this month / today per engine, and the free monthly allowance. */
export async function searchUsage() {
  const [m, d] = await Promise.all([hgetall<number>(`search:usage:${month()}`), hgetall<number>(`search:day:${today()}`)]);
  const engines = availableEngines();
  const limit = engines.reduce((a, e) => a + e.freeMonthly, 0);
  const used = engines.reduce((a, e) => a + (m[e.id] || 0), 0);
  const usedToday = engines.reduce((a, e) => a + (d[e.id] || 0), 0);
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  return { month: m, today: d, limit, used, usedToday, dailyBudget: Math.max(10, Math.floor(((limit - used) / daysLeft) * 0.8)), engines: engines.map((e) => ({ id: e.id, label: e.label, used: m[e.id] || 0, freeMonthly: e.freeMonthly })) };
}

/** Round-robin across configured engines; on failure fall through to the next one. */
export async function webSearch(q: string, n = 10, recent: Recency | boolean = 'month'): Promise<{ results: WebResult[]; engine: string | null; errors: string[] }> {
  const rec: Recency = recent === true ? 'month' : recent === false ? 'any' : recent;
  const engines = availableEngines();
  const errors: string[] = [];
  if (!engines.length) return { results: [], engine: null, errors: ['No web-search key set (add Tavily / Firecrawl / Exa / Serper / SearXNG in AI & Keys)'] };
  const cursor = await getJSON<number>('search:rr', 0);
  await setJSON('search:rr', cursor + 1);
  for (let k = 0; k < engines.length; k++) {
    const e = engines[(cursor + k) % engines.length];
    try {
      const results = (await e.run(q, n, rec)).filter((r) => r.url && /^https?:/.test(r.url));
      await count(e.id);
      return { results, engine: e.id, errors };
    } catch (err) {
      errors.push(`${e.id}: ${(err as Error).message.slice(0, 160)}`);
    }
  }
  return { results: [], engine: null, errors };
}

/** Deep mode: the same query on EVERY configured engine in parallel (each indexes different pages), merged. */
export async function webSearchAll(q: string, n = 20, rec: Recency = 'month'): Promise<{ results: WebResult[]; engines: string[]; errors: string[] }> {
  const engines = availableEngines();
  if (engines.length <= 1) {
    const r = await webSearch(q, n, rec);
    return { results: r.results, engines: r.engine ? [r.engine] : [], errors: r.errors };
  }
  const res = await Promise.allSettled(engines.map(async (e) => { const r = await e.run(q, n, rec); await count(e.id); return r; }));
  const seen = new Set<string>();
  const results: WebResult[] = [];
  const used: string[] = [];
  const errors: string[] = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return void errors.push(`${engines[i].id}: ${String((r.reason as Error)?.message).slice(0, 120)}`);
    used.push(engines[i].id);
    for (const x of r.value) {
      const k = x.url.split('#')[0].replace(/\?.*$/, '');
      if (x.url && /^https?:/.test(x.url) && !seen.has(k)) { seen.add(k); results.push(x); }
    }
  });
  return { results, engines: used, errors };
}

/** Read any web page as clean text (renders JS). Jina Reader works without a key (rate-limited). */
export async function readPage(url: string, maxChars = 12000): Promise<string> {
  const headers: Record<string, string> = { Accept: 'text/plain', 'X-Return-Format': 'markdown', 'X-Timeout': '20' };
  if (secret('JINA_API_KEY')) headers.Authorization = `Bearer ${secret('JINA_API_KEY')}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers, signal: ctrl.signal });
    if (r.ok) return (await r.text()).slice(0, maxChars);
  } catch {}
  finally {
    clearTimeout(t);
  }
  // fallback: direct fetch
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return stripHtml(await r.text(), maxChars);
}
