export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function http(url: string, init: RequestInit & { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
  const onAbort = () => ctrl.abort();
  init.signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json, text/html, application/xml;q=0.9, */*;q=0.8', ...(init.headers || {}) },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }
    return res;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Timeout calling ${new URL(url).host}`);
    throw e;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
}

export async function getJson<T = any>(url: string, init: Parameters<typeof http>[1] = {}): Promise<T> {
  const res = await http(url, init);
  return (await res.json()) as T;
}

export async function getText(url: string, init: Parameters<typeof http>[1] = {}): Promise<string> {
  const res = await http(url, init);
  return res.text();
}

/** Run async tasks with a concurrency limit; never throws, returns settled results. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { status: 'fulfilled', value: await fn(items[idx]) };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function stripHtml(html: string, max = 600): string {
  return decodeEntities((html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function decodeEntities(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const s = String(v);
  if (/^\d{10,13}$/.test(s)) return toIso(Number(s));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** "Posted 3 Days Ago", "Posted Today", "15 hours ago", "30+ days ago" -> ISO */
export function relativeToIso(s?: string | null): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  const now = Date.now();
  if (/today|just now|few (seconds|minutes)/.test(t)) return new Date(now).toISOString();
  if (/yesterday/.test(t)) return new Date(now - 864e5).toISOString();
  const m = t.match(/(\d+)\+?\s*(minute|hour|day|week|month)/);
  if (!m) return toIso(s);
  const n = Number(m[1]);
  const mult = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[m[2] as 'minute'];
  return new Date(now - n * mult).toISOString();
}

/** Minimal RSS/Atom item parser (no dependency). */
export function parseRss(xml: string): { title: string; link: string; pubDate: string | null; description: string; author?: string }[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
  };
  return items.map((b) => {
    let link = tag(b, 'link');
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      link = m ? m[1] : '';
    }
    return {
      title: stripHtml(decodeEntities(tag(b, 'title')), 300),
      link: decodeEntities(link),
      pubDate: toIso(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date')),
      description: stripHtml(decodeEntities(decodeEntities(tag(b, 'description') || tag(b, 'content') || tag(b, 'summary'))), 800),
      author: decodeEntities(tag(b, 'author') || tag(b, 'dc:creator') || tag(b, 'name')),
    };
  });
}
