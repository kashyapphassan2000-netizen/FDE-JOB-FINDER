import { secret } from './secrets';
import { getJSON, setJSON, hgetall, hset, hdel } from './store';
import { track } from './obs';
import type { CapturedPost } from './postwatch';

/**
 * TRULY LIVE X + LinkedIn posts (minutes old) through Apify — no login, no cookies, no account risk.
 *  • X:        scraper_one/x-posts-search      — "Latest" search with a last-N-hours window ($0.00025 / tweet + $0.0025 / run)
 *  • LinkedIn: harvestapi/linkedin-post-search — LinkedIn's own post search, last 24 h, newest first (~$0.002 / post)
 * Apify's free plan gives $5 of credit EVERY month → a spend guard keeps us under APIFY_MONTHLY_USD (default 4.5).
 * Posts land in ONE shared pool ('apify:pool'); every user's radar runs them through their own strict filter + AI check.
 */
const X_ACTOR = 'scraper_one~x-posts-search';
const LI_ACTOR = 'harvestapi~linkedin-post-search';
const month = () => new Date().toISOString().slice(0, 7);

export function apifyOn() { return Boolean(secret('APIFY_TOKEN')); }
export async function apifyBudget() {
  const cap = Number(secret('APIFY_MONTHLY_USD')) || 4.5;
  const spent = (await getJSON<number>(`apify:spend:${month()}`, 0)) || 0;
  return { cap, spent: Math.round(spent * 1000) / 1000, left: Math.max(0, cap - spent) };
}
async function charge(usd: number) { await setJSON(`apify:spend:${month()}`, ((await getJSON<number>(`apify:spend:${month()}`, 0)) || 0) + usd); }

async function run<T>(actor: string, input: unknown, timeoutSec = 150): Promise<T[]> {
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(secret('APIFY_TOKEN'))}&timeout=${timeoutSec}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout((timeoutSec + 20) * 1000),
  });
  if (!r.ok) throw new Error(`Apify ${actor} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T[];
}
const iso = (t: unknown): string | null => {
  if (t == null || t === '') return null;
  const n = Number(t);
  const d = Number.isFinite(n) && n > 0 ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(t));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export async function apifyX(query: string, hours: number, n = 40): Promise<CapturedPost[]> {
  type X = { postUrl?: string; postId?: string; postText?: string; timestamp?: number; author?: { name?: string; screenName?: string } };
  const items = await run<X>(X_ACTOR, { query, searchType: 'latest', timeWindowHours: hours, resultsCount: n });
  await charge(0.0025 + 0.00025 * items.length);
  return items.filter((x) => x.postText && (x.postUrl || x.postId)).map((x) => ({
    platform: 'x' as const, url: x.postUrl || `https://x.com/${x.author?.screenName || 'i'}/status/${x.postId}`,
    author: `${x.author?.name || ''} (@${x.author?.screenName || ''})`, text: x.postText || '', postedAt: iso(x.timestamp),
  }));
}

export async function apifyLinkedIn(queries: string[], n = 20): Promise<CapturedPost[]> {
  type L = { linkedinUrl?: string; content?: string; author?: { name?: string; info?: string }; postedAt?: { timestamp?: number; date?: string }; repost?: unknown };
  const items = await run<L>(LI_ACTOR, { searchQueries: queries, maxPosts: n, postedLimit: '24h', sortBy: 'date', profileScraperMode: 'short' });
  await charge(0.002 * Math.max(1, items.length));
  return items.filter((x) => x.linkedinUrl && x.content).map((x) => ({
    platform: 'li' as const, url: x.linkedinUrl!, author: [x.author?.name, x.author?.info].filter(Boolean).join(' — ').slice(0, 120),
    text: x.content || '', postedAt: iso(x.postedAt?.timestamp) || iso(x.postedAt?.date),
  }));
}

/** Search phrases from everyone's radar roles (owner first), as X / LinkedIn boolean queries. */
function phrases(roles: string[]) {
  const q = (r: string) => (/\s/.test(r) ? `"${r}"` : r);
  const uniq = Array.from(new Set(roles.map((r) => r.trim()).filter(Boolean))).slice(0, 14);
  return {
    x: `(${uniq.map(q).join(' OR ')}) (hiring OR "we're hiring" OR "we are hiring" OR "join us" OR "looking for" OR "DM me" OR "send your resume") -is:retweet`,
    li: [`hiring (${uniq.slice(0, 7).map(q).join(' OR ')})`, ...(uniq.length > 7 ? [`hiring (${uniq.slice(7, 14).map(q).join(' OR ')})`] : [])],
  };
}

/** Hourly from the cron: fetch when due (X every 4 h, LinkedIn every 12 h by default) and the month's credit allows. */
export async function harvest(roles: string[], opts: { force?: boolean } = {}): Promise<{ x: number; li: number; note: string }> {
  if (!apifyOn()) return { x: 0, li: 0, note: 'APIFY_TOKEN not set' };
  const b = await apifyBudget();
  if (b.left < 0.05) return { x: 0, li: 0, note: `monthly Apify credit used ($${b.spent} of $${b.cap})` };
  const meta = await getJSON<{ x?: number; li?: number }>('apify:meta', {});
  const xEvery = (Number(secret('APIFY_X_EVERY_H')) || 4) * 36e5, liEvery = (Number(secret('APIFY_LI_EVERY_H')) || 12) * 36e5;
  const p = phrases(roles);
  const out: CapturedPost[] = [];
  const notes: string[] = [];
  if (opts.force || !meta.x || Date.now() - meta.x > xEvery) {
    try { const r = await apifyX(p.x, Math.ceil(xEvery / 36e5) + 1, 40); out.push(...r); notes.push(`X ${r.length}`); meta.x = Date.now(); }
    catch (e) { notes.push(`X failed: ${(e as Error).message.slice(0, 120)}`); }
  }
  if (opts.force || !meta.li || Date.now() - meta.li > liEvery) {
    try { const r = await apifyLinkedIn(p.li, 20); out.push(...r); notes.push(`LinkedIn ${r.length}`); meta.li = Date.now(); }
    catch (e) { notes.push(`LinkedIn failed: ${(e as Error).message.slice(0, 120)}`); }
  }
  await setJSON('apify:meta', meta);
  for (const x of out) await hset('apify:pool', x.url.replace(/[?#].*$/, ''), { ...x, at: Date.now() });
  // keep the pool small: 72 h
  for (const [k, v] of Object.entries(await hgetall<{ at: number }>('apify:pool'))) if (Date.now() - v.at > 72 * 36e5) await hdel('apify:pool', k);
  const after = await apifyBudget();
  const note = `${notes.join(' · ') || 'not due yet'} · credit $${after.spent} / $${after.cap} this month`;
  if (notes.length) await track('source', 'Apify live posts', notes.some((n) => n.includes('failed')) ? 'warn' : 'ok', note);
  return { x: out.filter((o) => o.platform === 'x').length, li: out.filter((o) => o.platform === 'li').length, note };
}

export async function poolPosts(): Promise<CapturedPost[]> {
  return Object.values(await hgetall<CapturedPost & { at: number }>('apify:pool'));
}
