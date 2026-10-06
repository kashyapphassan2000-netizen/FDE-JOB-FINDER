import { secret } from './secrets';
import { getJSON, setJSON, hgetall, hset, hdel } from './store';
import { track } from './obs';
import type { CapturedPost } from './postwatch';

/**
 * TRULY LIVE X + LinkedIn posts (minutes old) through Apify — no login, no cookies, no account risk.
 *  • X:        scraper_one/x-posts-search      — "Latest" search with a last-N-hours window ($0.00025 / tweet + $0.0025 / run)
 *  • LinkedIn: harvestapi/linkedin-post-search — LinkedIn's own post search, last 24 h, newest first (~$0.002 / post)
 * Apify's free plan gives $5 of credit EVERY month → a spend guard keeps us under APIFY_MONTHLY_USD (default 4.5).
 * X 2 queries every 6 h + LinkedIn 1 query every 12 h ≈ $4.2/month. Posts land in ONE shared pool ('apify:pool'); every user's radar runs them through their own strict filter + AI check.
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

/** One short query per role (X caps queries at 100 chars), rotated across sweeps so every role is covered.
 *  Budget inside the free $5/month: X 2 queries × 20 tweets every 6 h (~$1.8) + LinkedIn 1 query × 20 posts every 12 h (~$2.4). */
function queries(roles: string[], places: string[], cursor: number) {
  const uniq = Array.from(new Set(roles.map((r) => r.trim()).filter((r) => r.length > 1))).slice(0, 30);
  const q = (r: string) => (/\s/.test(r) ? `"${r}"` : r);
  const city = places.find((p) => !/remote|india|anywhere/i.test(p)) || '';
  const pick = (k: number) => uniq[(cursor + k) % Math.max(1, uniq.length)];
  return {
    x: [0, 1].map((k) => `${q(pick(k))} (hiring OR "we're hiring" OR "join us") -is:retweet`.slice(0, 100)),
    li: [`hiring ${q(pick(0))}${city ? ` ${city}` : ''}`.slice(0, 120)],
  };
}

/** Hourly from the cron: fetch when due and the month's credit allows. Roles + places = every user's radar. */
export async function harvest(roles: string[], opts: { force?: boolean; places?: string[] } = {}): Promise<{ x: number; li: number; note: string }> {
  if (!apifyOn()) return { x: 0, li: 0, note: 'APIFY_TOKEN not set' };
  const b = await apifyBudget();
  if (b.left < 0.05) return { x: 0, li: 0, note: `monthly Apify credit used ($${b.spent} of $${b.cap})` };
  const meta = await getJSON<{ x?: number; li?: number; xc?: number; lc?: number }>('apify:meta', {});
  const xEvery = (Number(secret('APIFY_X_EVERY_H')) || 6) * 36e5, liEvery = (Number(secret('APIFY_LI_EVERY_H')) || 12) * 36e5;
  const places = opts.places?.length ? opts.places : ['Bengaluru', 'remote'];
  const out: CapturedPost[] = [];
  const notes: string[] = [];
  if (opts.force || !meta.x || Date.now() - meta.x > xEvery) {
    const qs = queries(roles, places, meta.xc || 0).x;
    for (const qq of qs) {
      try { const r = await apifyX(qq, Math.ceil(xEvery / 36e5) + 1, 20); out.push(...r); notes.push(`X "${qq.split(' (')[0]}" ${r.length}`); }
      catch (e) { notes.push(`X failed: ${(e as Error).message.slice(0, 120)}`); }
    }
    meta.x = Date.now(); meta.xc = (meta.xc || 0) + qs.length;
  }
  if (opts.force || !meta.li || Date.now() - meta.li > liEvery) {
    const qs = queries(roles, places, meta.lc || 0).li;
    try { const r = await apifyLinkedIn(qs, 20); out.push(...r); notes.push(`LinkedIn "${qs[0]}" ${r.length}`); }
    catch (e) { notes.push(`LinkedIn failed: ${(e as Error).message.slice(0, 120)}`); }
    meta.li = Date.now(); meta.lc = (meta.lc || 0) + 1;
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
