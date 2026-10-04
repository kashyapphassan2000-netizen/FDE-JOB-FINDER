import type { CompanyEntry, RawJob } from './types';
import { atsFromUrl, guessAts, probe } from './atsdetect';
import { FETCHERS } from './sources/ats';
import { extract } from './sources/careerpages';
import { getSettings, saveSettings } from './settings';
import { getJobs } from './refresh';
import { getJSON, hdel, hgetall, hset, setJSON } from './store';
import { classify, hashId, locationAllowed, locationTags } from './classify';
import { atsCareersUrl, dirKey } from './directory';
import { readPage, webSearch } from './search';
import { resolveDomain } from './outreach';
import { pool } from './http';
import { esc, sendMail } from './mailer';
import { loadVault, secret } from './secrets';
import { ownerEmails } from './access';

/**
 * Watch companies → email when they post a NEW job that needs AI or FDE people, in the locations you chose for that company.
 *  • Mapping on add: public ATS board (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday) = exact & fast;
 *    otherwise the careers page is test-read by the AI reader right away — you see if it works ("readable: N roles") or not.
 *  • Watcher (cron ~every 2 h): fetches every watched board, reads careers pages in rotation, diffs against what it saw before,
 *    and emails only the new relevant roles. The first check of a company is a baseline (no email flood).
 */
export interface WatchEntry {
  id: string; name: string; kind: 'ats' | 'page'; ats?: CompanyEntry['ats']; slug?: string; url: string;
  locations: string[]; // [] = your default rule (Bengaluru office or remote-from-India)
  addedAt: string; status: 'ok' | 'readable' | 'unreadable' | 'pending'; note: string;
  lastChecked?: string; lastTotal?: number; lastRelevant?: number; baseline?: boolean; error?: string;
}
export interface WatchHit { id: string; company: string; title: string; location: string; url: string; why: string; foundAt: string; emailed: boolean }

export const LOCATION_PRESETS = ['Bengaluru', 'Remote (India OK)', 'Hyderabad', 'Pune', 'Chennai', 'Mumbai', 'Delhi NCR', 'Remote (anywhere)', 'Anywhere'];

// roles that need AI / FDE people even when the title is generic ("Software Engineer, LLM Platform", "Solutions Engineer – AI")
const AI_NEED = /\b(ai|a\.i\.|ml|llm|llms|genai|gen ai|generative|machine learning|deep learning|agentic|agents?|nlp|computer vision|rag|prompt|inference|mlops|model|data scien|applied scien|forward[\s-]?deploy|deployment (engineer|strategist)|solutions? (engineer|architect)|copilot)\b/i;
const AI_NEED_DESC = /\b(llm|large language model|genai|generative ai|machine learning|pytorch|tensorflow|rag|langchain|fine-?tun|embedding|vector database|agentic|forward deployed)\b/gi;

export function relevantForAiFde(j: RawJob): { ok: boolean; why: string } {
  const c = classify(j);
  if (c.includes('FDE')) return { ok: true, why: 'FDE role' };
  if (c.includes('AIML')) return { ok: true, why: 'AI / ML role' };
  if (AI_NEED.test(j.title || '') && /engineer|developer|scientist|architect|lead|manager|analyst|specialist|consultant|strategist|research/i.test(j.title || '')) return { ok: true, why: 'needs AI skills (title)' };
  const hits = new Set(((j.description || '').match(AI_NEED_DESC) || []).map((x) => x.toLowerCase()));
  if (hits.size >= 2 && /engineer|developer|scientist|architect/i.test(j.title || '')) return { ok: true, why: `needs AI skills (${[...hits].slice(0, 3).join(', ')})` };
  return { ok: false, why: '' };
}

const ALIAS: Record<string, string[]> = {
  bengaluru: ['bengaluru', 'bangalore', 'blr'], hyderabad: ['hyderabad', 'hyd', 'secunderabad'], pune: ['pune'], chennai: ['chennai', 'madras'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane'], 'delhi ncr': ['delhi', 'gurgaon', 'gurugram', 'noida', 'ncr', 'faridabad', 'ghaziabad'],
};
export function locationMatch(loc: string, title: string, wanted: string[]): boolean {
  const L = `${loc} ${title}`.toLowerCase();
  if (!wanted.length) return !loc.trim() || locationAllowed(locationTags({ title, company: '', url: '', location: loc }), loc);
  for (const w of wanted.map((x) => x.toLowerCase())) {
    if (w === 'anywhere') return true;
    if (w.startsWith('remote (anywhere)') && /remote|anywhere|worldwide|distributed/.test(L)) return true;
    if (w.startsWith('remote (india')) { const t = locationTags({ title, company: '', url: '', location: loc }); if (t.includes('REMOTE_IN') || (/remote/.test(L) && /india|apac|asia/.test(L))) return true; }
    const names = ALIAS[w] || [w.replace(/\(.*\)/, '').trim()];
    if (names.some((n) => n && L.includes(n))) return true;
  }
  return !loc.trim(); // location not stated → still tell you
}

// ---------- mapping ----------
/** Read a careers page; if it lists no roles, follow up to 3 "open positions / search jobs" links on it (one hop). */
async function readRoles(name: string, url: string): Promise<{ jobs: RawJob[]; url: string; md: string }> {
  const md = await readPage(url, 30000);
  if (!md || md.length < 300) throw new Error('page is empty to readers (login wall or heavy JavaScript)');
  const jobs = await extract(name, url, md);
  if (jobs.length) return { jobs, url, md };
  const host = new URL(url).hostname.split('.').slice(-2).join('.');
  const links = [...md.matchAll(/\[([^\]]{2,80})\]\((https?:\/\/[^)\s]+)\)/g)]
    .filter(([, text, u]) => /job|position|opening|role|vacanc|search|explore|see all|view all|career/i.test(`${text} ${u}`) && u.includes(host) && u.split('#')[0] !== url.split('#')[0])
    .map(([, , u]) => u).filter((u, i, a) => a.indexOf(u) === i).slice(0, 3);
  for (const u of links) {
    try {
      const md2 = await readPage(u, 30000);
      const j2 = md2.length > 300 ? await extract(name, u, md2) : [];
      if (j2.length) return { jobs: j2, url: u, md: md2 };
    } catch {}
  }
  return { jobs: [], url, md };
}

async function mapOne(input: string, careersUrl?: string): Promise<Omit<WatchEntry, 'locations' | 'addedAt'>> {
  const raw = input.trim();
  const url = /^https?:\/\//i.test(raw) ? raw : careersUrl && /^https?:\/\//i.test(careersUrl) ? careersUrl : '';
  let name = url ? '' : raw.replace(/\s*\|.*$/, '');
  let det = url ? atsFromUrl(url) : null;
  let found = det ? await probe(det.ats, det.slug, name || det.slug) : null;
  if (det && !found && !careersUrl) return { id: `${det.ats}:${det.slug}`, name: name || det.slug, kind: 'page', url: '', status: 'unreadable', note: `❌ “${det.slug}” has no open jobs on ${det.ats} (wrong board name or the company moved). Type the company name instead.` };
  if (!found && name) found = await guessAts(name).catch(() => null);
  let pageUrl = url;
  const AGG = /linkedin|glassdoor|naukri|indeed|ambitionbox|apna\.co|foundit|instahyre|wellfound|cutshort|iimjobs|hirist|shine\.com|timesjobs|monster|simplyhired|ziprecruiter|jooble|talent\.com|careerjet|internshala|unstop|jobrapido|builtin|levels\.fyi|crunchbase|tracxn|wikipedia|youtube|reddit|quora/i;
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // a board only counts if it is THIS company's: slug ≈ name, or the job page title says "… at <Company>"
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isTheirs = (slug: string, title = '') => { const sk = slug.toLowerCase().replace(/[^a-z0-9]/g, ''); return (key.length >= 3 && (sk.includes(key.slice(0, Math.min(6, key.length))) || key.includes(sk))) || new RegExp(`(\\bat\\s+|@\\s*|[-|–]\\s*)${esc}\\b`, 'i').test(title); };
  // 2) search the job-board sites for this company (finds boards whose slug ≠ the company name, e.g. "PHONEPELIMITED")
  if (!found && name) {
    const r = await webSearch(`"${name}" (site:jobs.ashbyhq.com OR site:job-boards.greenhouse.io OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:apply.workable.com OR site:jobs.smartrecruiters.com OR site:myworkdayjobs.com)`, 10, 'any').catch(() => null);
    const cands = (r?.results || []).map((x) => ({ x, a: atsFromUrl(x.url) })).filter((c) => c.a && isTheirs(c.a.slug, c.x.title));
    for (const c of cands.slice(0, 3)) { found = await probe(c.a!.ats, c.a!.slug, name); if (found) break; }
  }
  // 3) official website → its /careers, /jobs, careers.<domain>, jobs.<domain> (the careers page often links to the real board)
  const tried: string[] = [];
  if (!found && !pageUrl && name) {
    const { domain } = await resolveDomain(name, () => {}).catch(() => ({ domain: '' }));
    if (domain) {
      const guesses = [`https://${domain}/careers`, `https://careers.${domain}`, `https://${domain}/jobs`, `https://jobs.${domain}`, `https://${domain}/careers/jobs`, `https://${domain}/company/careers`, `https://${domain}/join-us`];
      for (const g of guesses) {
        tried.push(g);
        try {
          const res = await fetch(g, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!res.ok) continue;
          const final = res.url || g;
          const a = atsFromUrl(final);
          if (a) { found = await probe(a.ats, a.slug, name); if (found) break; }
          const html = await res.text();
          const link = (html.match(/https?:\/\/[^\s"'<>]+/g) || []).map((u) => atsFromUrl(u)).find(Boolean);
          if (link) { found = await probe(link.ats, link.slug, name); if (found) break; }
          if (html.length > 1500) { pageUrl = final; break; }
        } catch {}
      }
    }
  }
  // 4) general web search for its careers page
  if (!found && !pageUrl && name) {
    const r = await webSearch(`${name} careers jobs openings`, 8, 'any').catch(() => null);
    const res = r?.results || [];
    const atsHit = res.find((x) => { const a = atsFromUrl(x.url); return a && isTheirs(a.slug, x.title); });
    if (atsHit) { det = atsFromUrl(atsHit.url); found = det ? await probe(det.ats, det.slug, name) : null; }
    const ok = res.filter((x) => !AGG.test(x.url) && /career|jobs|join|work-with-us|opening|hiring/i.test(x.url));
    if (!found) pageUrl = (ok.find((x) => new URL(x.url).hostname.replace(/[^a-z0-9]/g, '').includes(key.slice(0, 8))) || ok[0])?.url || '';
  }
  if (found) {
    name = name || found.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    const rel = found.jobs.filter((j) => relevantForAiFde(j).ok).length;
    return { id: `${found.ats}:${found.slug}`, name, kind: 'ats', ats: found.ats, slug: found.slug, url: atsCareersUrl({ ats: found.ats, slug: found.slug }), status: 'ok', note: `✅ Mapped to its ${found.ats} board — ${found.total} open roles (${rel} need AI/FDE). Checked automatically ~every 2 h.` };
  }
  if (!pageUrl) return { id: `x:${dirKey(raw)}`, name: raw, kind: 'page', url: '', status: 'unreadable', note: `❌ Could not find a careers page for “${raw}”${tried.length ? ` (tried ${tried.slice(0, 3).join(', ')}…)` : ''}. Paste its careers page link (open the company site → Careers → copy the address) — that always works.` };
  if (!name) { try { const h = new URL(pageUrl).hostname.replace(/^(www|careers|jobs)\./, '').split('.')[0]; name = h[0].toUpperCase() + h.slice(1); } catch { name = pageUrl; } }
  // test-read the page now so you know if watching it can work
  try {
    const { jobs, url: listUrl, md } = await readRoles(name, pageUrl);
    // a careers page may link to an ATS board → prefer that
    const atsLink = (md.match(/https?:\/\/[^\s)"']+/g) || []).map((u) => atsFromUrl(u)).find(Boolean);
    if (atsLink) { const p = await probe(atsLink.ats, atsLink.slug, name); if (p) return { id: `${p.ats}:${p.slug}`, name, kind: 'ats', ats: p.ats, slug: p.slug, url: atsCareersUrl(p), status: 'ok', note: `✅ Its careers page uses ${p.ats} — mapped to the board (${p.total} open roles). Checked automatically ~every 2 h.` }; }
    if (!jobs.length) return { id: listUrl, name, kind: 'page', url: listUrl, status: 'readable', note: '⚠️ The page opens, but no job list could be read from it (jobs load inside a search widget). Watching anyway — for big portals, paste the link of their job-search results page filtered to your city / role; if it stays empty use 📥 Capture.' };
    return { id: listUrl, name, kind: 'page', url: listUrl, status: 'readable', note: `✅ Careers page readable by the AI reader — ${jobs.length} roles found now${listUrl !== pageUrl ? ' (on its open-positions page)' : ''}. Checked in rotation (a few pages per run).` };
  } catch (e) {
    return { id: pageUrl, name, kind: 'page', url: pageUrl, status: 'unreadable', note: `❌ Not possible automatically: ${(e as Error).message.slice(0, 120)}. Open the page logged in and use 📥 Capture, or paste its job-board link.` };
  }
}

export async function addWatch(input: string, careersUrl?: string, locations: string[] = []) {
  const m = await mapOne(input, careersUrl);
  const all = await hgetall<WatchEntry>('watch:list');
  const prev = all[m.id];
  const entry: WatchEntry = { ...m, locations: locations.length ? locations : prev?.locations || [], addedAt: prev?.addedAt || new Date().toISOString(), baseline: prev?.baseline };
  if (m.status !== 'unreadable' || m.url) await hset('watch:list', entry.id, entry);
  // keep the main job feed in sync (ATS → refresh polls it; page → AI reader rotation)
  const s = await getSettings();
  if (entry.kind === 'ats' && entry.ats && entry.slug && !s.extraCompanies.some((c) => c.ats === entry.ats && c.slug === entry.slug)) await saveSettings({ extraCompanies: [...s.extraCompanies, { ats: entry.ats, slug: entry.slug, name: entry.name }] });
  if (entry.kind === 'page' && entry.url && entry.status !== 'unreadable' && !(s.extraCareerPages || []).some(([, u]) => u === entry.url)) await saveSettings({ extraCareerPages: [...(s.extraCareerPages || []), [entry.name, entry.url]] });
  return entry;
}

/** Bulk: one company per line — "name", "careers/job link", or "name | link | Bengaluru, Remote (India OK)". */
export async function bulkAdd(text: string, defaultLocations: string[]) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 40);
  const res = await pool(lines, 3, async (line) => {
    const parts = line.split('|').map((p) => p.trim());
    const [first, second, third] = parts;
    const link = [first, second].find((p) => p && /^https?:\/\//i.test(p));
    const name = /^https?:\/\//i.test(first) ? link! : first;
    const locs = third ? third.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : defaultLocations;
    return addWatch(name, link && link !== name ? link : undefined, locs);
  });
  return res.map((r, i) => (r.status === 'fulfilled' ? { line: lines[i], ok: r.value.status !== 'unreadable', name: r.value.name, note: r.value.note, url: r.value.url } : { line: lines[i], ok: false, name: lines[i], note: `❌ ${(r.reason as Error).message.slice(0, 140)}` }));
}

export async function setLocations(id: string, locations: string[]) {
  const all = await hgetall<WatchEntry>('watch:list');
  if (!all[id]) throw new Error('Unknown company');
  await hset('watch:list', id, { ...all[id], locations: locations.slice(0, 12) });
}

export async function removeWatch(id: string) {
  const all = await hgetall<WatchEntry>('watch:list');
  const e = all[id];
  await hdel('watch:list', id);
  await setJSON(`watch:seen:${id}`, []);
  if (!e) return;
  const s = await getSettings();
  if (e.kind === 'ats') await saveSettings({ extraCompanies: s.extraCompanies.filter((c) => `${c.ats}:${c.slug}` !== id) });
  else await saveSettings({ extraCareerPages: (s.extraCareerPages || []).filter(([, u]) => u !== e.url) });
}

/** Older adds (before this page existed) → watch entries, once. */
async function migrate() {
  const all = await hgetall<WatchEntry>('watch:list');
  const s = await getSettings();
  const now = new Date().toISOString();
  if (await getJSON<boolean>('watch:migrated', false)) return;
  await setJSON('watch:migrated', true);
  const auto = new Set((await getJSON<string[]>('disc:auto', [])).map((k) => k.replace(/[^a-z0-9]/g, '')));
  for (const c of s.extraCompanies) {
    const id = `${c.ats}:${c.slug}`;
    if (auto.has(c.name.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue; // startups auto-added by the daily scan are not "yours"
    if (!all[id]) await hset('watch:list', id, { id, name: c.name, kind: 'ats', ats: c.ats, slug: c.slug, url: atsCareersUrl(c), locations: [], addedAt: now, status: 'ok', note: `Mapped to its ${c.ats} board` } satisfies WatchEntry);
  }
  for (const [name, url] of s.extraCareerPages || []) if (!all[url]) await hset('watch:list', url, { id: url, name, kind: 'page', url, locations: [], addedAt: now, status: 'readable', note: 'Careers page (AI reader)' } satisfies WatchEntry);
}

export async function listWatch() {
  await migrate();
  const [all, jobs, hits, meta] = await Promise.all([hgetall<WatchEntry>('watch:list'), getJobs(), getJSON<WatchHit[]>('watch:hits', []), getJSON<{ at: string; log: string[] } | null>('watch:meta', null)]);
  const per = new Map<string, { n: number; fde: number }>();
  for (const j of jobs) { const k = dirKey(j.company); const e = per.get(k) || { n: 0, fde: 0 }; e.n++; if (j.categories.includes('FDE')) e.fde++; per.set(k, e); }
  const items = Object.values(all).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ ...e, feed: per.get(dirKey(e.name)) || { n: 0, fde: 0 }, newHits: hits.filter((h) => h.company === e.name).length }));
  return { items, total: items.length, hits: hits.slice(0, 200), meta, notifyTo: notifyTo(), locationPresets: LOCATION_PRESETS };
}

function notifyTo(): string { return secret('WATCH_NOTIFY_TO') || secret('DIGEST_TO') || ownerEmails()[1] || ownerEmails()[0] || ''; }

// ---------- the watcher ----------
export async function runWatch(budgetMs = 240000): Promise<{ checked: number; newHits: number; emailed: boolean; log: string[] }> {
  const t0 = Date.now();
  await loadVault();
  await migrate();
  const all = Object.values(await hgetall<WatchEntry>('watch:list')).filter((e) => e.status !== 'unreadable' && e.url);
  const log: string[] = [];
  const fresh: WatchHit[] = [];
  // ATS boards every run (fast APIs); careers pages: oldest-checked first, up to 6 per run (AI reader is slow)
  const ats = all.filter((e) => e.kind === 'ats');
  const pages = all.filter((e) => e.kind === 'page').sort((a, b) => (a.lastChecked || '').localeCompare(b.lastChecked || '')).slice(0, 6);
  await pool([...ats, ...pages], 5, async (e) => {
    if (Date.now() - t0 > budgetMs) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      let jobs: RawJob[];
      if (e.kind === 'ats' && e.ats && e.slug) jobs = await FETCHERS[e.ats]({ ats: e.ats, slug: e.slug, name: e.name }, ctrl.signal);
      else jobs = (await readRoles(e.name, e.url)).jobs;
      const rel = jobs.map((j) => ({ j, r: relevantForAiFde(j) })).filter((x) => x.r.ok && locationMatch(x.j.location || '', x.j.title, e.locations));
      const seenKey = `watch:seen:${e.id}`;
      const seen = new Set(await getJSON<string[]>(seenKey, []));
      const isBaseline = !e.baseline;
      for (const { j, r } of rel) {
        const k = hashId(j.url || `${j.title}|${j.location}`);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!isBaseline) fresh.push({ id: k, company: e.name, title: j.title, location: j.location || 'not stated', url: j.url, why: r.why, foundAt: new Date().toISOString(), emailed: false });
      }
      await setJSON(seenKey, [...seen].slice(-3000));
      await hset('watch:list', e.id, { ...e, lastChecked: new Date().toISOString(), lastTotal: jobs.length, lastRelevant: rel.length, baseline: true, error: undefined });
      log.push(`${e.name}: ${jobs.length} roles, ${rel.length} match AI/FDE + your locations${isBaseline ? ' (first check = baseline, no email)' : ''}`);
    } catch (err) {
      await hset('watch:list', e.id, { ...e, lastChecked: new Date().toISOString(), error: (err as Error).message.slice(0, 160) });
      log.push(`${e.name}: failed — ${(err as Error).message.slice(0, 100)}`);
    } finally { clearTimeout(timer); }
  });
  let emailed = false;
  if (fresh.length) {
    const to = notifyTo();
    if (to) {
      try {
        const by = new Map<string, WatchHit[]>();
        for (const h of fresh) by.set(h.company, [...(by.get(h.company) || []), h]);
        const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:640px;margin:auto"><div style="background:#0d1424;color:#fff;padding:16px 20px;border-radius:14px"><div style="font-size:18px;font-weight:700">${fresh.length} new AI / FDE role${fresh.length > 1 ? 's' : ''} at companies you watch</div><div style="opacity:.8;font-size:13px">${[...by.keys()].map(esc).join(' · ')}</div></div>${[...by.entries()].map(([co, hs]) => `<h3 style="margin:16px 0 4px">${esc(co)}</h3>${hs.map((h) => `<div style="padding:8px 0;border-bottom:1px solid #eee"><a href="${esc(h.url)}" style="font-weight:600;color:#0d1424;font-size:15px">${esc(h.title)}</a><div style="color:#666;font-size:13px">${esc(h.location)} · ${esc(h.why)}</div></div>`).join('')}`).join('')}<p style="color:#999;font-size:12px">From your Watch companies list · FDE Job Finder</p></div>`;
        await sendMail(to, `🔔 ${fresh.length} new AI/FDE role${fresh.length > 1 ? 's' : ''}: ${[...by.keys()].slice(0, 3).join(', ')}${by.size > 3 ? '…' : ''}`, html);
        emailed = true;
        for (const h of fresh) h.emailed = true;
      } catch (e) { log.push(`email failed: ${(e as Error).message.slice(0, 160)}`); }
    } else log.push('no email address to notify — set DIGEST_TO in AI & Keys');
    const prev = await getJSON<WatchHit[]>('watch:hits', []);
    await setJSON('watch:hits', [...fresh, ...prev].slice(0, 500));
  }
  await setJSON('watch:meta', { at: new Date().toISOString(), log });
  return { checked: ats.length + pages.length, newHits: fresh.length, emailed, log };
}
