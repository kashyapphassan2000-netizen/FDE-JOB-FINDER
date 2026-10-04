import { secret } from './secrets';
import { getJSON, setJSON } from './store';
import { stripHtml } from './http';

/**
 * Web search for the AI agent. Uses whichever engines you have keys for and ROTATES between them,
 * so several free tiers stack (Tavily 1k/mo + Firecrawl 1k/mo + Exa + Linkup + Serper 2.5k + SerpApi 250 …).
 * A self-hosted SearXNG URL gives truly unlimited searches.
 */
export interface WebResult { title: string; url: string; snippet: string; date?: string | null; engine: string }

type Engine = { id: string; label: string; needs: string; run: (q: string, n: number, recent: boolean) => Promise<WebResult[]> };

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

const weekAgo = () => new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);

export const ENGINES: Engine[] = [
  {
    id: 'searxng', label: 'SearXNG (self-hosted, unlimited)', needs: 'SEARXNG_URL',
    run: async (q, n, recent) => {
      const d = await j(`${secret('SEARXNG_URL').replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}&format=json${recent ? '&time_range=month' : ''}`, { method: 'GET' });
      return (d.results || []).slice(0, n).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || '', date: r.publishedDate || null, engine: 'searxng' }));
    },
  },
  {
    id: 'tavily', label: 'Tavily', needs: 'TAVILY_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.tavily.com/search', { method: 'POST', headers: { Authorization: `Bearer ${secret('TAVILY_API_KEY')}` }, body: JSON.stringify({ query: q, max_results: Math.min(n, 20), search_depth: 'basic', ...(recent ? { time_range: 'month' } : {}) }) });
      return (d.results || []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content || '', date: r.published_date || null, engine: 'tavily' }));
    },
  },
  {
    id: 'firecrawl', label: 'Firecrawl', needs: 'FIRECRAWL_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.firecrawl.dev/v2/search', { method: 'POST', headers: { Authorization: `Bearer ${secret('FIRECRAWL_API_KEY')}` }, body: JSON.stringify({ query: q, limit: n, ...(recent ? { tbs: 'qdr:m' } : {}) }) });
      const arr = Array.isArray(d.data) ? d.data : d.data?.web || [];
      return arr.map((r: any) => ({ title: r.title || r.metadata?.title || '', url: r.url, snippet: r.description || '', engine: 'firecrawl' }));
    },
  },
  {
    id: 'exa', label: 'Exa', needs: 'EXA_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.exa.ai/search', { method: 'POST', headers: { 'x-api-key': secret('EXA_API_KEY') }, body: JSON.stringify({ query: q, numResults: n, type: 'auto', ...(recent ? { startPublishedDate: weekAgo() } : {}), contents: { highlights: { maxCharacters: 400 } } }) });
      return (d.results || []).map((r: any) => ({ title: r.title || '', url: r.url, snippet: (r.highlights || []).join(' ') || r.text || '', date: r.publishedDate || null, engine: 'exa' }));
    },
  },
  {
    id: 'linkup', label: 'Linkup', needs: 'LINKUP_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://api.linkup.so/v1/search', { method: 'POST', headers: { Authorization: `Bearer ${secret('LINKUP_API_KEY')}` }, body: JSON.stringify({ q, depth: 'standard', outputType: 'searchResults' }) });
      return (d.results || []).slice(0, n).map((r: any) => ({ title: r.name || '', url: r.url, snippet: r.content || '', engine: 'linkup' }));
    },
  },
  {
    id: 'serper', label: 'Serper (Google)', needs: 'SERPER_API_KEY',
    run: async (q, n, recent) => {
      const d = await j('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': secret('SERPER_API_KEY') }, body: JSON.stringify({ q, num: n, ...(recent ? { tbs: 'qdr:m' } : {}) }) });
      return (d.organic || []).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet || '', date: r.date || null, engine: 'serper' }));
    },
  },
  {
    id: 'brave', label: 'Brave', needs: 'BRAVE_API_KEY',
    run: async (q, n, recent) => {
      const d = await j(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.min(n, 20)}${recent ? '&freshness=pm' : ''}`, { method: 'GET', headers: { 'X-Subscription-Token': secret('BRAVE_API_KEY'), Accept: 'application/json' } });
      return (d.web?.results || []).map((r: any) => ({ title: stripHtml(r.title, 200), url: r.url, snippet: stripHtml(r.description || '', 400), date: r.age || null, engine: 'brave' }));
    },
  },
  {
    id: 'jina', label: 'Jina search', needs: 'JINA_API_KEY',
    run: async (q, n, recent) => {
      const d = await j(`https://s.jina.ai/?q=${encodeURIComponent(q)}`, { method: 'GET', headers: { Authorization: `Bearer ${secret('JINA_API_KEY')}`, Accept: 'application/json', 'X-Respond-With': 'no-content' } }, 40000);
      return (d.data || []).slice(0, n).map((r: any) => ({ title: r.title || '', url: r.url, snippet: r.description || '', date: r.date || null, engine: 'jina' }));
    },
  },
  {
    id: 'serpapi', label: 'SerpApi (Google)', needs: 'SERPAPI_KEY',
    run: async (q, n, recent) => {
      const d = await j(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&num=${n}${recent ? '&tbs=qdr:m' : ''}&api_key=${secret('SERPAPI_KEY')}`, { method: 'GET' });
      return (d.organic_results || []).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet || '', date: r.date || null, engine: 'serpapi' }));
    },
  },
];

export function availableEngines(): Engine[] {
  return ENGINES.filter((e) => Boolean(secret(e.needs)));
}

/** Round-robin across configured engines; on failure fall through to the next one. */
export async function webSearch(q: string, n = 10, recent = true): Promise<{ results: WebResult[]; engine: string | null; errors: string[] }> {
  const engines = availableEngines();
  const errors: string[] = [];
  if (!engines.length) return { results: [], engine: null, errors: ['No web-search key set (add Tavily / Firecrawl / Exa / Serper / SearXNG in AI & Keys)'] };
  const cursor = await getJSON<number>('search:rr', 0);
  await setJSON('search:rr', cursor + 1);
  for (let k = 0; k < engines.length; k++) {
    const e = engines[(cursor + k) % engines.length];
    try {
      const results = (await e.run(q, n, recent)).filter((r) => r.url && /^https?:/.test(r.url));
      return { results, engine: e.id, errors };
    } catch (err) {
      errors.push(`${e.id}: ${(err as Error).message.slice(0, 160)}`);
    }
  }
  return { results: [], engine: null, errors };
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
