import { createHash } from 'node:crypto';
import { getJSON, setJSON, hgetall, hset, hdel } from './store';
import { availableEngines, liveEngines, readPage, runEngine, webSearch, type Recency, type WebResult } from './search';
import { fetchTweet, tweetIdFromUrl } from './xposts';
import { dateFromUrl } from './postdate';
import { toIso, pool } from './http';
import { esc, sendMail } from './mailer';
import { tenant, runAs, tenantFor } from './tenant';
import { ownerEmails, roleOf } from './access';
import { secret, loadVault } from './secrets';
import { track } from './obs';

/**
 * HIRING POST RADAR — X + LinkedIn posts by ANYONE (founders, engineers, recruiters) hiring for your roles,
 * in your places, scanned every hour, verified at the source, collected, and emailed in batches (default 100).
 *  • strict: a real hiring signal + one of your roles + (one of your places, remote, or no place stated) + posted within N days;
 *    job-seekers ("open to work", "looking for a job") and other cities only are dropped
 *  • every email address written in a post is saved to a contact list WITH the post it came from
 *  • free + unlimited: SearXNG (self-hosted) does the searching when it is set; paid-quota engines are used sparingly
 *  • every user has their own radar (roles, places, extra keywords, excludes, batch size, email) — personal keys
 */
export interface PwConfig {
  enabled: boolean; roles: string[]; places: string[]; keywords: string[]; exclude: string[];
  platforms: ('x' | 'li')[]; maxAgeDays: number; batch: number; email: string; allowUnstated: boolean; updatedAt?: string;
}
export interface PwPost {
  id: string; platform: 'x' | 'li'; url: string; author: string; text: string; postedAt: string | null; foundAt: string;
  roles: string[]; place: string; emails: string[]; links: string[]; sent: boolean; verified: boolean;
}
export interface PwContact { email: string; who: string; company: string; platform: 'x' | 'li'; sourceUrl: string; context: string; foundAt: string; postedAt: string | null }
export interface PwMeta { lastRun?: string; lastLog?: string[]; cursor: number; lastEmail?: string; sentTotal: number; scanned: number }

export const DEFAULT_PW: PwConfig = {
  enabled: true,
  roles: ['forward deployed engineer', 'FDE', 'AI engineer', 'ML engineer', 'machine learning engineer', 'applied AI engineer', 'LLM engineer', 'GenAI engineer', 'AI/ML engineer', 'solutions engineer AI', 'deployment engineer'],
  places: ['Bengaluru', 'Bangalore', 'remote', 'India'],
  keywords: [], exclude: ['intern', 'internship', 'unpaid'], platforms: ['x', 'li'], maxAgeDays: 7, batch: 100, email: '', allowUnstated: true,
};

const HIRING = /\b(hiring|we'?re hiring|we are hiring|now hiring|is hiring|join (us|our team|my team)|looking for (an?|our|talented|strong|experienced)|open (role|position)s?|job opening|openings?\b|vacanc|apply (here|now|at|via|using)|dm (me|us)|send (your |me your )?(cv|resume)|share (your )?(cv|resume)|referrals? (open|available)|#hiring|#wearehiring|we'?re looking for|building (a|our) team)/i;
const SEEKER = /#opentowork|open to work|i'?m (actively )?looking for (a |new )?(job|role|opportunit)|seeking (a |new )?(job|role|opportunit)|need a job|laid off.*looking|my resume|hire me/i;
const OTHER_PLACES = /\b(columbus|ohio|chicago|boston|atlanta|denver|dallas|houston|los angeles|california|texas|virginia|new jersey|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad|kochi|jaipur|san francisco|new york|nyc|london|berlin|seattle|toronto|singapore|dubai|austin|paris|amsterdam|sydney|tokyo)\b/i;
const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BAD_EMAIL = /noreply|no-reply|example\.|@x\.com|@twitter\.com|@linkedin\.com|\.(png|jpg|gif|webp)$|sentry|wixpress/i;

const idOf = (url: string) => createHash('sha1').update(url.replace(/\?.*$/, '')).digest('hex').slice(0, 14);
const isLiPost = (u: string) => /linkedin\.com\/(posts|feed\/update)\//i.test(u);

export async function getPwConfig(): Promise<PwConfig> {
  const c = await getJSON<Partial<PwConfig> | null>('pw:config', null);
  const t = tenant();
  const email = c?.email || (t.role === 'owner' ? secret('DIGEST_TO') : t.email);
  return { ...DEFAULT_PW, ...(c || {}), email };
}
export async function savePwConfig(p: Partial<PwConfig>): Promise<PwConfig> {
  const cur = await getPwConfig();
  const list = (x: unknown, n: number, fb: string[]) => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[,\n]/) : fb).map((v) => String(v).trim()).filter(Boolean).slice(0, n);
  const next: PwConfig = {
    enabled: p.enabled ?? cur.enabled,
    roles: list(p.roles, 25, cur.roles), places: list(p.places, 15, cur.places), keywords: list(p.keywords, 25, cur.keywords), exclude: list(p.exclude, 30, cur.exclude).map((x) => x.toLowerCase()),
    platforms: (Array.isArray(p.platforms) ? p.platforms.filter((x) => x === 'x' || x === 'li') : cur.platforms) as PwConfig['platforms'],
    maxAgeDays: Math.max(1, Math.min(30, Number(p.maxAgeDays ?? cur.maxAgeDays) || 7)),
    batch: Math.max(10, Math.min(500, Number(p.batch ?? cur.batch) || 100)),
    email: String(p.email ?? cur.email ?? '').trim().slice(0, 200), allowUnstated: p.allowUnstated ?? cur.allowUnstated, updatedAt: new Date().toISOString(),
  };
  if (!next.roles.length) next.roles = DEFAULT_PW.roles;
  if (!next.platforms.length) next.platforms = ['x', 'li'];
  await setJSON('pw:config', next);
  const t = tenant(); // the hourly cron runs every user who has a radar
  await hset('pw:users', t.ns, { email: t.role === 'owner' ? 'owner' : t.email, enabled: next.enabled });
  return next;
}

/** LinkedIn public post page → just the post text (drops the sign-in wall, menus, reactions, comments chrome). */
export function linkedInPost(md: string): { author: string; text: string } | null {
  // reader output: "## Name’s Post" → profile link → "1d" → THE POST → "See more comments" / "## Explore …"
  const m = md.match(/^#{1,3}\s*(.+?)[’']s Post\s*$/m);
  if (!m) return null;
  const after = md.slice((m.index || 0) + m[0].length).split('\n');
  const out: string[] = [];
  for (const raw of after) {
    const l = raw.trim();
    if (/^#{1,3}\s|^\[?see more comments|^\[like\]|^like$|^\d+\s*(reactions?|comments?)|^to view or add a comment|^more relevant posts|^share$/i.test(l)) { if (out.length) break; else continue; }
    if (!l || /^\[!\[image/i.test(l) || /^\d+[smhdwy]o?$/.test(l) || /^(edited|follow|copy)$/i.test(l) || /^\d+[smhdwy]o?\s+edited$/i.test(l) || /^[\d,.]+k?\s+followers$/i.test(l) || /^\*\s+\[report this/i.test(l) || /trk=public_post_feed-actor-name|trk=public_post_feed-actor-image/.test(l)) continue;
    out.push(l.replace(/\[([^\]]*)\]\((https?:[^)]*)\)/g, (_, t, u) => { if (/linkedin\.com\/(company|in|feed\/hashtag|signup)/.test(u)) return ` ${t} `; const red = u.match(/redir\/redirect\?url=([^&]+)/); if (red) return ` ${decodeURIComponent(red[1])} `; return /^https?:/.test(t) ? ` ${t} ` : ` ${t} ${u.replace(/[?&]trk=.*$/, '')} `; }));
  }
  const text = out.join('\n').trim();
  return text.length > 30 ? { author: m[1].trim(), text } : null;
}

function cleanLinkedIn(md: string, snippet: string): string {
  const exact = linkedInPost(md);
  if (exact) return exact.text;
  const JUNK = /^(published time|url source|markdown content|title:|by clicking continue|sign in|join now|agree & join|skip to|report this|like$|comment$|repost$|send$|see more|show more|cookie|user agreement|privacy policy|copyright policy|community guidelines|©|linkedin corporation|\d+ (reactions?|comments?|reposts?)|follow$|connect$|explore (topics|more)|more relevant posts|to view or add a comment|new to linkedin|forgot password|email or phone|password|show$|continue with google|accessibility|brand policy|guest controls|language)/i;
  const lines = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\((https?:[^)]*)\)/g, '$1 $2').split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .filter((l) => l.length > 1 && !JUNK.test(l) && !/^(https?:\/\/)?(www\.)?linkedin\.com\/(signup|login|legal|help|feed|uas)/i.test(l) && !/^={3,}|^-{3,}$/.test(l));
  let text = lines.join('\n');
  const head = (snippet || '').replace(/\s+/g, ' ').slice(0, 40).toLowerCase();
  const i = head.length > 15 ? text.toLowerCase().replace(/\s+/g, ' ').indexOf(head) : -1;
  if (i > 0) text = text.replace(/\s+/g, ' ').slice(i);
  return text.trim();
}

/** Query plan: every role × platform, rotated across runs (cursor) so all combinations get covered within a few hours. */
function plan(c: PwConfig, cursor: number, max: number): { q: string; platform: 'x' | 'li' }[] {
  const placeQ = c.places.length ? `(${c.places.slice(0, 5).map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' OR ')})` : '';
  const terms = [...c.roles, ...c.keywords];
  const all: { q: string; platform: 'x' | 'li' }[] = [];
  for (const t of terms) for (const pf of c.platforms) {
    const site = pf === 'x' ? 'site:x.com' : 'site:linkedin.com/posts';
    const role = /\s/.test(t) ? `"${t}"` : t;
    all.push({ q: `${site} ${role} hiring ${placeQ}`.trim(), platform: pf });
    all.push({ q: `${site} ${role} (hiring OR "we're hiring" OR "join us" OR "DM me")`, platform: pf });
  }
  const out: typeof all = [];
  for (let i = 0; i < Math.min(max, all.length); i++) out.push(all[(cursor + i) % all.length]);
  return out;
}

async function search(q: string, rec: Recency): Promise<WebResult[]> {
  const live = (await liveEngines()).map((e) => e.id);
  if (live.includes('searxng')) {
    const r = await runEngine('searxng', q, 30, rec); // free + unlimited
    if (r.length >= 3) return r;
    // SearXNG's upstream engines throttle bursts → this query falls back to the free-tier engines (cached, rotated)
  }
  return (await webSearch(q, 20, rec).catch(() => ({ results: [] as WebResult[] }))).results; // rotates paid-free engines (cached)
}

function judge(text: string, c: PwConfig): { ok: boolean; roles: string[]; place: string; why?: string } {
  const t = text.toLowerCase();
  if (SEEKER.test(text)) return { ok: false, roles: [], place: '', why: 'job seeker' };
  if (/^\s*@\w/.test(text) && !/we'?re hiring|is hiring|are hiring|hiring for|join (us|our team)|send (me )?your (cv|resume)/i.test(text)) return { ok: false, roles: [], place: '', why: 'reply, not a hiring post' };
  if (!HIRING.test(text)) return { ok: false, roles: [], place: '', why: 'no hiring signal' };
  if (c.exclude.some((x) => x && new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t))) return { ok: false, roles: [], place: '', why: 'excluded word' };
  const roles = [...c.roles, ...c.keywords].filter((r) => {
    const w = r.toLowerCase();
    if (w === 'fde') return /\bfde\b|forward[- ]deployed/.test(t);
    return t.includes(w) || (w.includes('ml') && /machine learning/.test(t) && w.replace(/\bml\b/, 'machine learning').split(' ').every((x) => t.includes(x)));
  });
  if (!roles.length) return { ok: false, roles: [], place: '', why: 'none of your roles' };
  const place = c.places.find((p) => t.includes(p.toLowerCase())) || (/\bremote\b|work from home|wfh|anywhere/.test(t) && c.places.some((p) => /remote/i.test(p)) ? 'remote' : '');
  // "remote" that is really US / EU / UK only is not OK for someone in India (strict)
  if (place === 'remote' && /\b(us|usa|u\.s\.|eu|europe|uk|canada|latam|emea)[- ]?(only|based|residents?|citizens?)\b|\bremote[- ](us|usa|eu|uk|europe|canada)\b|- (eu|us|uk)!?\b|within the (us|eu|uk)|must (be|reside) in the (us|eu|uk)/i.test(text) && !/india|apac|asia|worldwide|anywhere|global/i.test(text)) return { ok: false, roles, place: '', why: 'remote but US/EU/UK only' };
  if (/\b(w2|c2c|corp[- ]to[- ]corp|green card|us citizens?|usc only|h1b|security clearance|ts\/sci)\b/i.test(text) && !/india|bengaluru|bangalore/i.test(text)) return { ok: false, roles, place: '', why: 'US-only (W2 / visa / clearance)' };
  if (place === 'remote' && /(usd|us\$|\$\s?\d{2,3}[,k]|£\s?\d|€\s?\d|\d\s?(gbp|eur)\b)/i.test(text) && !/india|inr|lpa|₹|apac|asia|worldwide|anywhere|global/i.test(text)) return { ok: false, roles, place: '', why: 'remote abroad (pay in USD/GBP/EUR, India not mentioned)' };
  if (!place) {
    const other = text.match(OTHER_PLACES)?.[1];
    if (other) return { ok: false, roles, place: '', why: `other place only (${other})` };
    if (!c.allowUnstated) return { ok: false, roles, place: '', why: 'no place stated' };
  }
  return { ok: true, roles, place: place || 'not stated' };
}

/** One scan for the CURRENT user. */
export async function runRadar(opts: { budgetMs?: number; maxQueries?: number } = {}): Promise<{ newPosts: number; pending: number; contacts: number; log: string[]; emailed?: string }> {
  await loadVault();
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 120000;
  const c = await getPwConfig();
  const meta = await getJSON<PwMeta>('pw:meta', { cursor: 0, sentTotal: 0, scanned: 0 });
  const log: string[] = [];
  if (!availableEngines().length) return { newPosts: 0, pending: 0, contacts: 0, log: ['no search engine configured'] };
  const qs = plan(c, meta.cursor, opts.maxQueries ?? 12);
  const rec: Recency = c.maxAgeDays <= 1 ? 'day' : c.maxAgeDays <= 7 ? 'week' : 'month';
  const raw: (WebResult & { platform: 'x' | 'li' })[] = [];
  await pool(qs, 4, async (x) => {
    if (Date.now() - t0 > budget * 0.5) return;
    for (const r of await search(x.q, rec)) raw.push({ ...r, platform: x.platform });
  });
  log.push(`${qs.length} searches → ${raw.length} results`);
  const have = await hgetall<PwPost>('pw:posts');
  const cand = new Map<string, WebResult & { platform: 'x' | 'li' }>();
  for (const r of raw) {
    let url = r.url.split('#')[0];
    const tid = tweetIdFromUrl(url);
    if (r.platform === 'x') { if (!tid) continue; url = `https://x.com/${url.match(/(?:x|twitter)\.com\/([^/]+)\//i)?.[1] || 'i'}/status/${tid}`; }
    else if (!isLiPost(url)) continue;
    url = url.replace(/\?.*$/, '');
    const id = idOf(url);
    if (have[id] || cand.has(id)) continue;
    const d = dateFromUrl(url);
    if (d && Date.now() - Date.parse(d) > c.maxAgeDays * 864e5) continue; // exact age from the post ID
    cand.set(id, { ...r, url });
  }
  log.push(`${cand.size} new candidate posts`);
  // verify at the source + read full text
  const fresh: PwPost[] = [];
  const reasons: Record<string, number> = {};
  await pool([...cand.entries()].slice(0, 80), 6, async ([id, r]) => {
    if (Date.now() - t0 > budget * 0.9) return;
    let text = `${r.title}\n${r.snippet}`, author = '', postedAt = dateFromUrl(r.url), verified = false, links: string[] = [];
    if (r.platform === 'x') {
      const tw = await fetchTweet(tweetIdFromUrl(r.url)!, 8000).catch(() => null);
      if (!tw) { reasons['could not open'] = (reasons['could not open'] || 0) + 1; return; } // deleted / protected → never shown
      text = tw.text; author = `${tw.author} (@${tw.handle})`; postedAt = tw.createdAt ? toIso(tw.createdAt) || postedAt : postedAt; links = tw.links; verified = true;
    } else {
      author = r.title.match(/^(.+?)\s+(?:on|posted on) LinkedIn/i)?.[1] || (r.url.match(/\/posts\/([a-z0-9-]+?)_/i)?.[1] || '').split('-').filter((w) => !/\d/.test(w)).join(' ').replace(/\b\w/g, (x) => x.toUpperCase());
      verified = Boolean(postedAt);
      if (HIRING.test(text) || /hir|job|role|opening/i.test(text)) {
        const md = await readPage(r.url, 25000).catch(() => '');
        const pub = md.match(/Published Time:\s*(\S+)/i)?.[1];
        if (!postedAt && pub && !Number.isNaN(Date.parse(pub))) postedAt = new Date(pub).toISOString();
        const body = cleanLinkedIn(md, r.snippet).replace(/^\d+[smhdwy]o?\s+edited\s+/i, '').replace(/^[\d,.]+k?\s+followers\s+/i, '');
        if (body.length > 80 && body.length > r.snippet.length * 0.8) { text = body.slice(0, 3000); verified = true; }
        const who = linkedInPost(md)?.author || md.match(/^Title:\s*(.+?)\s+on LinkedIn/im)?.[1];
        if (who && who.length < 60) author = who.trim();
        else if (!linkedInPost(md)) verified = Boolean(postedAt) && body.length > 80; // no clean post block → keep only with a proven date
        links = Array.from(new Set(text.match(/https?:\/\/[^\s)]+/g) || [])).filter((u) => !/linkedin\.com\/(feed|in|company|signup|login|legal)/i.test(u)).slice(0, 8);
      }
    }
    if (postedAt && Date.now() - Date.parse(postedAt) > c.maxAgeDays * 864e5) { reasons['too old'] = (reasons['too old'] || 0) + 1; return; }
    if (!postedAt) { reasons['no provable date'] = (reasons['no provable date'] || 0) + 1; return; }
    const j = judge(`${text} ${author}`, c);
    if (!j.ok) { reasons[j.why || 'filtered'] = (reasons[j.why || 'filtered'] || 0) + 1; return; }
    const emails = Array.from(new Set((text.match(EMAIL_RX) || []).map((e) => e.toLowerCase().replace(/[.,;:]+$/, '')).filter((e) => !BAD_EMAIL.test(e)))).slice(0, 6);
    fresh.push({ id, platform: r.platform, url: r.url, author: author.slice(0, 100), text: text.slice(0, 3000), postedAt, foundAt: new Date().toISOString(), roles: j.roles.slice(0, 4), place: j.place, emails, links, sent: false, verified });
  });
  for (const p of fresh) await hset('pw:posts', p.id, p);
  // settings changed or rules got stricter → re-check what has not been emailed yet
  let rejudged = 0;
  for (const p of Object.values(have)) if (!p.sent && !judge(`${p.text} ${p.author}`, c).ok) { await hdel('pw:posts', p.id); rejudged++; }
  if (rejudged) log.push(`${rejudged} earlier posts removed by the current rules`);
  let contacts = 0;
  const known = await hgetall<PwContact>('pw:contacts');
  for (const p of fresh) for (const e of p.emails) {
    if (known[e]) continue;
    const company = e.split('@')[1].replace(/\.(com|ai|io|co|in|org|net|tech|dev)(\.[a-z]{2})?$/, '');
    const i = p.text.toLowerCase().indexOf(e);
    await hset('pw:contacts', e, { email: e, who: p.author, company: /gmail|yahoo|outlook|hotmail|proton|icloud/.test(company) ? '' : company, platform: p.platform, sourceUrl: p.url, context: p.text.slice(Math.max(0, i - 160), i + 80).replace(/\s+/g, ' '), foundAt: p.foundAt, postedAt: p.postedAt });
    contacts++;
  }
  log.push(`${fresh.length} verified hiring posts saved · ${contacts} new contact emails${Object.keys(reasons).length ? ` · dropped: ${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`);
  // prune: keep 60 days
  for (const p of Object.values(have)) if (Date.now() - Date.parse(p.foundAt) > 60 * 864e5) await hdel('pw:posts', p.id);
  const all = Object.values(await hgetall<PwPost>('pw:posts'));
  const pending = all.filter((p) => !p.sent).length;
  let emailed: string | undefined;
  if (pending >= c.batch && c.email) emailed = await emailBatch().catch((e) => `email failed: ${(e as Error).message.slice(0, 120)}`);
  if (emailed) log.push(emailed);
  await setJSON('pw:meta', { ...meta, cursor: (meta.cursor + qs.length) % 100000, lastRun: new Date().toISOString(), lastLog: log, scanned: meta.scanned + cand.size });
  await track('source', 'Hiring post radar', 'ok', `${tenant().ns}: ${log.join(' · ')}`, Date.now() - t0);
  return { newPosts: fresh.length, pending: emailed && !emailed.startsWith('email failed') ? 0 : pending, contacts, log, emailed };
}

/** Email every unsent post (newest first) + the contacts found in them, then mark them sent. */
export async function emailBatch(): Promise<string> {
  const c = await getPwConfig();
  if (!c.email) throw new Error('Add the email to send to');
  const posts = Object.values(await hgetall<PwPost>('pw:posts')).filter((p) => !p.sent).sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  if (!posts.length) return 'nothing new to send';
  const batch = posts.slice(0, 300);
  const contacts = Object.values(await hgetall<PwContact>('pw:contacts')).filter((x) => batch.some((p) => p.url === x.sourceUrl));
  const row = (p: PwPost) => `<tr><td style="padding:8px 6px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;font-size:12px;color:#666">${p.platform === 'x' ? '𝕏' : 'in'} · ${p.postedAt ? p.postedAt.slice(0, 10) : ''}</td><td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:13px"><b>${esc(p.author || 'post')}</b> <span style="color:#0a7">${esc(p.roles.join(', '))}</span> · <span style="color:#555">${esc(p.place)}</span><div style="color:#333;margin:3px 0">${esc(p.text.slice(0, 280))}${p.text.length > 280 ? '…' : ''}</div>${p.emails.length ? `<div>📧 ${p.emails.map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(' · ')}</div>` : ''}<a href="${esc(p.url)}">Open post →</a></td></tr>`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:760px;margin:auto"><div style="background:#0d1424;color:#fff;padding:16px 18px;border-radius:12px"><div style="font-size:18px;font-weight:700">${batch.length} new hiring posts (X + LinkedIn)</div><div style="opacity:.8;font-size:13px">${esc(c.roles.slice(0, 5).join(' · '))} · ${esc(c.places.join(' / '))} · verified at the source, newest first</div></div>
${contacts.length ? `<h3>📧 ${contacts.length} hiring contact emails found in these posts</h3><table style="width:100%;border-collapse:collapse;font-size:13px">${contacts.map((x) => `<tr><td style="padding:4px 6px"><a href="mailto:${esc(x.email)}">${esc(x.email)}</a></td><td style="padding:4px 6px;color:#555">${esc(x.who)}</td><td style="padding:4px 6px"><a href="${esc(x.sourceUrl)}">source</a></td></tr>`).join('')}</table>` : ''}
<h3>Posts</h3><table style="width:100%;border-collapse:collapse">${batch.map(row).join('')}</table><p style="color:#999;font-size:12px">From your Hiring post radar. Change roles, places, batch size or email in the app (Agent searches → Hiring post radar). Reply fast — the first 24–72 h get most interviews.</p></div>`;
  const via = await sendMail(c.email, `🎯 ${batch.length} new hiring posts${contacts.length ? ` + ${contacts.length} contact emails` : ''} — ${c.roles[0]}`, html);
  for (const p of batch) await hset('pw:posts', p.id, { ...p, sent: true });
  const meta = await getJSON<PwMeta>('pw:meta', { cursor: 0, sentTotal: 0, scanned: 0 });
  await setJSON('pw:meta', { ...meta, lastEmail: new Date().toISOString(), sentTotal: meta.sentTotal + batch.length });
  return `emailed ${batch.length} posts to ${c.email} via ${via}`;
}

/** Hourly cron: every user's radar (owner first), within the time budget. */
export async function runAllRadars(budgetMs = 260000) {
  const t0 = Date.now();
  const users = await hgetall<{ email: string; enabled: boolean }>('pw:users');
  if (!users.owner) users.owner = { email: 'owner', enabled: true }; // the owner's radar runs with defaults even before saving settings
  const out: string[] = [];
  const order = ['owner', ...Object.keys(users).filter((k) => k !== 'owner')];
  for (const ns of order) {
    const u = users[ns];
    const left = budgetMs - (Date.now() - t0);
    if (!u?.enabled || left < 30000) continue;
    if (ns !== 'owner' && !(await roleOf(u.email))) { out.push(`${u.email}: no access any more`); continue; }
    const t = tenantFor(u.email, ownerEmails());
    const r = await runAs(t, () => runRadar({ budgetMs: Math.min(ns === 'owner' ? 150000 : 60000, left - 10000), maxQueries: ns === 'owner' ? 16 : 6 })).catch((e) => ({ log: [`failed ${(e as Error).message}`] }));
    out.push(`${ns}: ${r.log.join(' · ')}`);
  }
  return { log: out };
}
