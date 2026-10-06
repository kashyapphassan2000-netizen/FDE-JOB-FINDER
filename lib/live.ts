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
import { matchesQuery, parseQuery } from './nlq';
import { readPage, webSearchAll, type Recency } from './search';
import { dateFromUrl } from './postdate';
import { fetchTweet, tweetIdFromUrl } from './xposts';

/**
 * LIVE feeds for the LinkedIn / X tabs — straight from the platform, last 24 h, no search-engine delay.
 *  • LinkedIn: the public guest job search (f_TPR=r86400 = posted in the last 24 h), Bengaluru + remote-India, newest first.
 *  • X: twitterapi.io advanced search (needs TWITTERAPI_IO_KEY, ~$0.15 per 1,000 tweets) — X has no free live search;
 *    without the key the tab can only use web search, which indexes tweets late.
 * Cached 10 minutes so many clicks cost nothing.
 */
const CACHE_MS = 10 * 6e4;
const key = (k: string, q: string) => `live:${k}:${createHash('sha1').update(q.toLowerCase().trim()).digest('hex').slice(0, 12)}`;

export async function linkedinLive(q: string): Promise<{ jobs: RawJob[]; recent: RawJob[]; blocked: boolean; at: string; cached: boolean; queries: string[]; where: string[] }> {
  const ck = key('li2', q);
  const hit = await getJSON<{ jobs: RawJob[]; recent: RawJob[]; blocked: boolean; at: string; queries: string[]; where: string[] } | null>(ck, null);
  if (hit && Date.now() - Date.parse(hit.at) < CACHE_MS) return { ...hit, cached: true };
  // plain English → LinkedIn keywords + location ("ML engineer jobs in Berlin, remote ok" → kw "ML engineer", loc "Berlin" + remote)
  const nlq = parseQuery(q);
  const kws = nlq.keywords ? [nlq.keywords] : (await getSettings()).keywords.slice(0, 4);
  const places = nlq.location
    ? [{ loc: nlq.location, extra: '', via: nlq.location }, ...(nlq.remote ? [{ loc: nlq.location, extra: '&f_WT=2', via: `remote · ${nlq.location}` }] : [])]
    : nlq.remote ? [{ loc: 'Worldwide', extra: '&f_WT=2', via: 'remote · worldwide' }, { loc: 'India', extra: '&f_WT=2', via: 'remote · India' }]
    : [{ loc: 'Bengaluru, Karnataka, India', extra: '', via: 'Bengaluru' }, { loc: 'India', extra: '&f_WT=2', via: 'remote · India' }];
  let blocked = 0;
  const grab = async (tpr: string) => {
    const out: RawJob[] = [];
    await Promise.all(kws.flatMap((kw) => places.map((p) => ({ kw, ...p }))).map(async (p) => {
      for (const start of [0, 25]) {
        try {
          const html = await getText(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(p.kw)}&location=${encodeURIComponent(p.loc)}&f_TPR=${tpr}${p.extra}&sortBy=DD&start=${start}`, { timeoutMs: 12000, headers: { Accept: 'text/html' } });
          const jobs = parseLinkedInCards(html).map((j) => ({ ...j, via: `LinkedIn · ${p.via}` }));
          out.push(...jobs);
          if (jobs.length < 10) break;
        } catch (e) {
          if (e instanceof HttpError && [429, 999, 403].includes(e.status)) { blocked++; break; }
        }
      }
    }));
    const seen = new Set<string>();
    return out
      .filter((j) => { const k = j.url.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true; })
      .filter((j) => !hardNoise(j) && (nlq.keywords ? true : classify(j).length > 0))
      .sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  };
  const day = nlq.hours <= 24 ? await grab('r86400') : [];
  // fewer than 10 in 24 h (or a wider window asked) → also show the last 7 days, clearly labelled
  const weekAll = day.length < 10 || nlq.hours > 24 ? await grab(nlq.hours > 168 ? 'r2592000' : 'r604800') : [];
  const dayIds = new Set(day.map((j) => j.url.split('?')[0]));
  const recent = weekAll.filter((j) => !dayIds.has(j.url.split('?')[0]));
  const res = { jobs: day.slice(0, 120), recent: recent.slice(0, 120), blocked: !day.length && !recent.length && blocked > 0, at: new Date().toISOString(), queries: kws, where: places.map((p) => p.via) };
  await setJSON(ck, res);
  await track('source', 'LinkedIn live', res.blocked ? 'fail' : 'ok', `${day.length} (24 h) + ${recent.length} (7 d) for "${kws.join(' | ')}" in ${res.where.join(', ')}${blocked ? ` · ${blocked} blocked calls` : ''}`);
  return { ...res, cached: false };
}

/**
 * FREE live post search (no paid X key): the user's literal words → site:x.com / site:linkedin.com/posts on every search engine at once
 * (SearXNG + the rest), real post time from the post ID (X snowflake / LinkedIn activity id — exact, not a crawl date),
 * X posts read in full through the public embed API. Split into last 24 h and the last 7 days so it is never a silent 0.
 */
export async function postsLive(kind: 'x' | 'li', q: string): Promise<{ posts: LivePost[]; recent: LivePost[]; undated: LivePost[]; other?: LivePost[]; at: string; cached: boolean; queries: string[]; engines: string[]; error?: string }> {
  const ck = key(`p2${kind}`, q);
  const hit = await getJSON<{ posts: LivePost[]; recent: LivePost[]; undated: LivePost[]; at: string; queries: string[]; engines: string[] } | null>(ck, null);
  if (hit && Date.now() - Date.parse(hit.at) < CACHE_MS) return { ...hit, cached: true };
  const nlq = parseQuery(q);
  const kw = nlq.keywords || '"forward deployed" OR "AI engineer" OR "ML engineer"';
  const loc = nlq.location || (nlq.remote ? 'remote' : '');
  const site = kind === 'x' ? 'site:x.com' : 'site:linkedin.com/posts';
  const queries = Array.from(new Set([
    `${site} ${q.trim() || kw}`.trim(), // exactly what was typed
    `${site} ${kw} ${loc} hiring`.replace(/\s+/g, ' ').trim(),
    `${site} ${kw} ${loc}`.replace(/\s+/g, ' ').trim(),
    `${site} "${nlq.keywords || 'AI engineer'}" (hiring OR "we're hiring" OR "join us" OR "DM me")${loc ? ` ${loc}` : ''}`,
  ])).slice(0, 4);
  const engines = new Set<string>();
  const errors: string[] = [];
  const raw: { url: string; title: string; snippet: string }[] = [];
  const t0 = Date.now();
  await Promise.all(queries.flatMap((qq) => (['day', 'week'] as Recency[]).map(async (rec) => {
    const r = await Promise.race([webSearchAll(qq, 20, rec), new Promise<null>((res) => setTimeout(() => res(null), 35000))]).catch((e) => { errors.push((e as Error).message); return null; });
    if (!r) return;
    r.engines.forEach((e) => engines.add(e));
    raw.push(...r.results);
  })));
  // thin? widen: simpler phrasing + a month index window (post age is still checked from the post ID below)
  const isPostUrl = (u: string) => (kind === 'x' ? Boolean(tweetIdFromUrl(u)) : /linkedin\.com\/(posts|feed\/update)\//i.test(u));
  if (raw.filter((r) => isPostUrl(r.url)).length < 6) {
    const t = nlq.terms.filter((w) => !/^(founders?|people|someone|anyone|companies|startups?)$/.test(w));
    const more = Array.from(new Set([`${site} ${t.join(' ')} hiring`, `${site} ${t.slice(-2).join(' ')} ${loc}`.trim(), `${site} "${t.slice(-2).join(' ')}" job`])).filter((x) => !queries.includes(x)).slice(0, 3);
    queries.push(...more);
    await Promise.all(more.flatMap((qq) => (['week', 'month'] as Recency[]).map(async (rec) => {
      const r = await Promise.race([webSearchAll(qq, 20, rec), new Promise<null>((res) => setTimeout(() => res(null), 25000))]).catch(() => null);
      if (r) { r.engines.forEach((e) => engines.add(e)); raw.push(...r.results); }
    })));
  }
  const seen = new Set<string>();
  const items: LivePost[] = [];
  for (const r of raw) {
    let url = r.url.split('#')[0];
    const tid = tweetIdFromUrl(url);
    if (kind === 'x') { if (!tid) continue; url = url.replace(/^(https?:\/\/)(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/]+)\/status(?:es)?\/(\d+).*$/i, 'https://x.com/$2/status/$3'); }
    else if (!/linkedin\.com\/(posts|feed\/update)\//i.test(url)) continue;
    const k = tid || url.replace(/\?.*$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    const author = kind === 'x' ? (url.match(/x\.com\/([^/]+)\//)?.[1] || '') : (r.title.match(/^(.+?)\s+(?:on|posted on) LinkedIn/i)?.[1] || url.match(/\/posts\/([a-z0-9-]+?)_/i)?.[1]?.replace(/-/g, ' ') || '');
    items.push({ text: `${r.title}\n${r.snippet}`.trim(), url, author, postedAt: dateFromUrl(url) });
  }
  // ACCURACY: every post is opened at the source. X → public embed API (exact text, author, time; a post that cannot be
  // opened is deleted/protected → kept out of the main list). LinkedIn → the public post page (full text + real author).
  const verified = new Set<string>();
  if (kind === 'x') {
    await Promise.all(items.slice(0, 60).map(async (p) => {
      const t = await fetchTweet(tweetIdFromUrl(p.url)!, 8000).catch(() => null);
      if (t) { verified.add(p.url); p.text = `${t.text}${t.links.length ? `\n${t.links.join(' ')}` : ''}`; p.author = t.handle || p.author; p.postedAt = t.createdAt ? toIso(t.createdAt) || p.postedAt : p.postedAt; p.likes = t.likes; }
    }));
  } else {
    const byAge = [...items].sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || '')).slice(0, 14);
    await Promise.race([Promise.all(byAge.map(async (p) => {
      const md = await readPage(p.url, 8000).catch(() => '');
      if (!md || /sign in to view|authwall|join linkedin/i.test(md.slice(0, 400)) && md.length < 600) return;
      const who = md.match(/^Title:\s*(.+?)\s+on LinkedIn/im)?.[1];
      const body = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\((https?:[^)]*)\)/g, '$1 $2').split('\n').map((l) => l.trim())
        .filter((l) => l && !/^(sign in|join now|agree & join|skip to main|report this|like|comment|repost|send|see more|show more|cookie|user agreement|privacy policy|©|linkedin corporation|url source|markdown content|title:)/i.test(l)).join('\n');
      if (body.length > p.text.length) { p.text = body.slice(0, 2500); verified.add(p.url); }
      if (who) p.author = who.trim().slice(0, 80);
    })), new Promise((r) => setTimeout(r, 22000))]);
    for (const p of items) if (p.postedAt) verified.add(p.url); // the activity id in the URL proves the post exists and its time
  }
  const unverified = items.filter((p) => !verified.has(p.url));
  items.splice(0, items.length, ...items.filter((p) => verified.has(p.url)));
  const relevant = items.filter((p) => matchesQuery(`${p.text} ${p.author}`, nlq) || !nlq.terms.length);
  const pool = relevant.length >= 3 ? relevant : items; // a too-strict word match never hides everything
  const age = (p: LivePost) => (p.postedAt ? Date.now() - Date.parse(p.postedAt) : Infinity);
  const hiring = (p: LivePost) => (/\bhiring\b|we'?re hiring|join (us|our team)|looking for (an?|our)|open (role|position)|\bapply\b|dm me|send (your |me your )?(cv|resume)|vacanc|\bopenings?\b|job opening|we are looking|referral|#hiring/i.test(p.text) ? 0 : 1);
  const sort = (a: LivePost, b: LivePost) => hiring(a) - hiring(b) || age(a) - age(b);
  const res = {
    // main lists = real hiring posts only (role + a hiring signal); everything else matching your words is kept separately
    posts: pool.filter((p) => hiring(p) === 0 && age(p) <= 864e5).sort(sort),
    recent: pool.filter((p) => hiring(p) === 0 && age(p) > 864e5 && age(p) <= 7 * 864e5).sort(sort),
    other: pool.filter((p) => hiring(p) === 1 && age(p) <= 7 * 864e5).sort(sort).slice(0, 20),
    undated: [...pool.filter((p) => !p.postedAt), ...unverified].slice(0, 15),
    at: new Date().toISOString(), queries, engines: [...engines],
    ...(errors.length && !items.length ? { error: errors[0].slice(0, 200) } : {}),
  };
  await setJSON(ck, res);
  await track('source', `${kind === 'x' ? 'X' : 'LinkedIn'} posts live (free)`, items.length ? 'ok' : 'warn', `${res.posts.length} (24 h) + ${res.recent.length} (7 d) for "${q.slice(0, 60)}" · ${[...engines].join(', ') || 'no engine answered'}`, Date.now() - t0);
  return { ...res, cached: false };
}

export interface LivePost { text: string; url: string; author: string; postedAt: string | null; likes?: number }
export async function xLive(q: string): Promise<{ posts: LivePost[]; recent?: LivePost[]; undated?: LivePost[]; needsKey: boolean; free?: boolean; at: string; cached: boolean; query: string; queries?: string[]; engines?: string[]; error?: string }> {
  const query = `(${q.trim() || '"forward deployed" OR "AI engineer" OR "ML engineer" OR "applied AI"'}) (hiring OR "we're hiring" OR "join us" OR "looking for") -is:retweet`;
  // no paid key → the free path: every search engine + exact post times + full text from X's public embed API
  if (!secret('TWITTERAPI_IO_KEY')) return { ...(await postsLive('x', q)), needsKey: false, free: true, query };
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
