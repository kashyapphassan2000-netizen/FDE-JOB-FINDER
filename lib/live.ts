import { createHash } from 'node:crypto';
import { getJSON, setJSON } from './store';
import { getText, getJson, HttpError, toIso } from './http';
import { parseLinkedInCards } from './sources/community';
import { classify } from './classify';
import { hardNoise } from './semantic';
import { secret } from './secrets';
import { getSettings } from './settings';
import { track } from './obs';
import type { RawJob } from './types';

/**
 * LIVE feeds for the LinkedIn / X tabs — straight from the platform, last 24 h, no search-engine delay.
 *  • LinkedIn: the public guest job search (f_TPR=r86400 = posted in the last 24 h), Bengaluru + remote-India, newest first.
 *  • X: twitterapi.io advanced search (needs TWITTERAPI_IO_KEY, ~$0.15 per 1,000 tweets) — X has no free live search;
 *    without the key the tab can only use web search, which indexes tweets late.
 * Cached 10 minutes so many clicks cost nothing.
 */
const CACHE_MS = 10 * 6e4;
const key = (k: string, q: string) => `live:${k}:${createHash('sha1').update(q.toLowerCase().trim()).digest('hex').slice(0, 12)}`;

export async function linkedinLive(q: string): Promise<{ jobs: RawJob[]; blocked: boolean; at: string; cached: boolean; queries: string[] }> {
  const ck = key('li', q);
  const hit = await getJSON<{ jobs: RawJob[]; blocked: boolean; at: string; queries: string[] } | null>(ck, null);
  if (hit && Date.now() - Date.parse(hit.at) < CACHE_MS) return { ...hit, cached: true };
  const kws = q.trim() ? [q.trim()] : (await getSettings()).keywords.slice(0, 4);
  const out: RawJob[] = [];
  let blocked = 0;
  const plans = kws.flatMap((kw) => [{ kw, loc: 'Bengaluru, Karnataka, India', extra: '' }, { kw, loc: 'India', extra: '&f_WT=2' }]);
  await Promise.all(plans.map(async (p) => {
    for (const start of [0, 25]) {
      try {
        const html = await getText(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(p.kw)}&location=${encodeURIComponent(p.loc)}&f_TPR=r86400${p.extra}&sortBy=DD&start=${start}`, { timeoutMs: 12000, headers: { Accept: 'text/html' } });
        const jobs = parseLinkedInCards(html).map((j) => ({ ...j, via: p.extra ? 'LinkedIn · remote India' : 'LinkedIn · Bengaluru' }));
        out.push(...jobs);
        if (jobs.length < 10) break;
      } catch (e) {
        if (e instanceof HttpError && [429, 999, 403].includes(e.status)) { blocked++; break; }
      }
    }
  }));
  const seen = new Set<string>();
  const jobs = out
    .filter((j) => { const k = j.url.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true; })
    .filter((j) => !hardNoise(j) && (q.trim() ? true : classify(j).length > 0))
    .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  const res = { jobs: jobs.slice(0, 120), blocked: !jobs.length && blocked > 0, at: new Date().toISOString(), queries: kws };
  await setJSON(ck, res);
  await track('source', 'LinkedIn live (24 h)', res.blocked ? 'fail' : 'ok', `${jobs.length} jobs for "${kws.join(' | ')}"${blocked ? ` · ${blocked} blocked calls` : ''}`);
  return { ...res, cached: false };
}

export interface LivePost { text: string; url: string; author: string; postedAt: string | null; likes?: number }
export async function xLive(q: string): Promise<{ posts: LivePost[]; needsKey: boolean; at: string; cached: boolean; query: string; error?: string }> {
  const query = `(${q.trim() || '"forward deployed" OR "AI engineer" OR "ML engineer" OR "applied AI"'}) (hiring OR "we're hiring" OR "join us" OR "looking for") -is:retweet`;
  if (!secret('TWITTERAPI_IO_KEY')) return { posts: [], needsKey: true, at: new Date().toISOString(), cached: false, query };
  const ck = key('x', query);
  const hit = await getJSON<{ posts: LivePost[]; at: string } | null>(ck, null);
  if (hit && Date.now() - Date.parse(hit.at) < CACHE_MS) return { ...hit, needsKey: false, cached: true, query };
  try {
    const since = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const d = await getJson<{ tweets: { text: string; url?: string; id: string; createdAt: string; likeCount?: number; author?: { userName: string } }[] }>(`https://api.twitterapi.io/twitter/tweet/advanced_search?query=${encodeURIComponent(`${query} since:${since}`)}&queryType=Latest`, { headers: { 'X-API-Key': secret('TWITTERAPI_IO_KEY') }, timeoutMs: 20000 });
    const posts = (d.tweets || []).map((t) => ({ text: t.text, url: t.url || `https://x.com/${t.author?.userName}/status/${t.id}`, author: t.author?.userName || '', postedAt: toIso(t.createdAt), likes: t.likeCount }))
      .filter((p) => p.postedAt && Date.now() - Date.parse(p.postedAt) <= 864e5);
    const res = { posts, at: new Date().toISOString() };
    await setJSON(ck, res);
    await track('source', 'X live (24 h)', 'ok', `${posts.length} posts`);
    return { ...res, needsKey: false, cached: false, query };
  } catch (e) {
    await track('source', 'X live (24 h)', 'fail', (e as Error).message);
    return { posts: [], needsKey: false, at: new Date().toISOString(), cached: false, query, error: (e as Error).message.slice(0, 200) };
  }
}
