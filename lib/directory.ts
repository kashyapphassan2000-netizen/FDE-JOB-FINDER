import type { CompanyEntry, Job } from './types';
import { DEFAULT_COMPANIES } from './companies';
import { CAREER_PAGES } from './sources/careerpages';
import { getSettings } from './settings';
import { getJobs } from './refresh';
import { getDiscovered, type DiscoveredCompany } from './discover';
import { getJSON, hgetall, setJSON } from './store';
import type { Find } from './agent';

/**
 * Companies hiring — one global directory of every company the app knows, with its careers page and LIVE counts of
 * open FDE and AI/ML roles (from the jobs fetched on every refresh, already filtered to Bengaluru office / remote-from-India).
 * Sources: tracked ATS boards (+ ones you added), custom careers pages from the Excel, new startups (YC hiring + funding news,
 * auto-added daily), companies seen in job feeds and agent finds. History (first seen, last FDE role seen) persists in 'dir:hist'.
 */
export interface DirRole { title: string; url: string; location: string; posted: string | null; fde: boolean }
export interface DirCompany {
  key: string; name: string; careersUrl: string; careersKind: 'ats' | 'careers page' | 'yc' | 'search';
  ats?: string; source: string; tags: string[]; newStartup: boolean; fundedAt?: string; teamSize?: number;
  fde: number; aiml: number; blr: number; remoteIn: number; new24h: number; latest: string | null; roles: DirRole[];
  hiresFde: boolean; firstSeen: string; lastFdeSeen?: string;
}
type Hist = Record<string, { firstSeen: string; lastFdeSeen?: string; lastAiSeen?: string }>;

export const dirKey = (n: string) => n.toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(inc|ltd|llc|pvt|private|limited|technologies|technology|labs|corp|corporation|co|hq)\b/g, '').replace(/[^a-z0-9]/g, '');
const AGGREGATOR = /listing|unstop|internshala|telegram|reddit|hacker news|remotive|remote ?ok|himalayas|jobicy|working nomads|we work remotely|nodesk|the ?muse|80,000|linkedin|instahyre|naukri|foundit|indeed|glassdoor|wellfound|capture|on x$|via mercor|jobgether|confidential|stealth|^n\/?a$/i;

export function atsCareersUrl(c: Pick<CompanyEntry, 'ats' | 'slug'>): string {
  switch (c.ats) {
    case 'greenhouse': return `https://job-boards.greenhouse.io/${c.slug}`;
    case 'lever': return `https://jobs.lever.co/${c.slug}`;
    case 'ashby': return `https://jobs.ashbyhq.com/${c.slug}`;
    case 'workable': return `https://apply.workable.com/${c.slug}/`;
    case 'smartrecruiters': return `https://jobs.smartrecruiters.com/${c.slug}`;
    case 'workday': { const [t, wd, site] = c.slug.split('|'); return `https://${t}.${wd}.myworkdayjobs.com/${site}`; }
  }
}

/** Called after every refresh: remember when each company first appeared and when it last had an FDE / AI role. */
export async function recordDirectory(jobs: Job[]) {
  const hist = await getJSON<Hist>('dir:hist', {});
  const now = new Date().toISOString();
  for (const j of jobs) {
    if (!j.company || AGGREGATOR.test(j.company)) continue;
    const k = dirKey(j.company);
    if (!k) continue;
    const h = (hist[k] ||= { firstSeen: now });
    if (j.categories.includes('FDE')) h.lastFdeSeen = now;
    if (j.categories.includes('AIML')) h.lastAiSeen = now;
  }
  await setJSON('dir:hist', hist);
}

export async function getDirectory(): Promise<{ companies: DirCompany[]; at: string; counts: Record<string, number> }> {
  const [settings, jobs, disc, hist, findsH] = await Promise.all([getSettings(), getJobs(), getDiscovered(), getJSON<Hist>('dir:hist', {}), hgetall<Find>('agent:finds')]);
  const now = new Date().toISOString();
  const map = new Map<string, DirCompany>();
  const base = (name: string, careersUrl: string, careersKind: DirCompany['careersKind'], source: string, extra: Partial<DirCompany> = {}): DirCompany => ({
    key: dirKey(name), name, careersUrl, careersKind, source, tags: [], newStartup: false, fde: 0, aiml: 0, blr: 0, remoteIn: 0, new24h: 0, latest: null, roles: [], hiresFde: false, firstSeen: now, ...extra,
  });
  const put = (c: DirCompany) => { if (c.key && !map.has(c.key)) map.set(c.key, c); };

  const disabled = new Set(settings.disabledCompanies);
  for (const c of [...DEFAULT_COMPANIES, ...settings.extraCompanies]) {
    if (disabled.has(`${c.ats}:${c.slug}`)) continue;
    put(base(c.name, atsCareersUrl(c), 'ats', settings.extraCompanies.includes(c) ? 'Watched (added)' : 'Tracked board', { ats: c.ats, tags: c.tag ? [c.tag] : [], hiresFde: c.tag === 'fde' }));
  }
  for (const [name, url] of CAREER_PAGES) put(base(name, url, 'careers page', 'Excel careers page'));
  for (const d of disc as DiscoveredCompany[]) {
    if (d.status === 'dismissed') continue;
    const url = d.ats ? atsCareersUrl(d.ats) : d.ycSlug ? `https://www.ycombinator.com/companies/${d.ycSlug}/jobs` : d.website || '';
    const k = dirKey(d.name);
    const ex = map.get(k);
    const startup = { newStartup: true, fundedAt: d.fundedAt, teamSize: d.teamSize, tags: [...(ex?.tags || []), ...d.tags.slice(0, 4)] };
    if (ex) Object.assign(ex, startup, { source: `${ex.source} · ${d.source}` });
    else put(base(d.name, url, d.ats ? 'ats' : d.ycSlug ? 'yc' : 'careers page', d.source, { ats: d.ats?.ats, ...startup }));
    // roles found on the startup's board (not all of them reach the Jobs list)
    const c = map.get(k)!;
    for (const r of d.roles) if (!c.roles.some((x) => x.url === r.url)) c.roles.push({ title: r.title, url: r.url, location: r.location, posted: null, fde: /forward[\s-]?deploy|deployment engineer|deployed engineer/i.test(r.title) });
  }
  // live roles from every job fetched (Bengaluru office / remote-from-India rule already applied)
  for (const j of jobs) {
    if (!j.company || AGGREGATOR.test(j.company)) continue;
    const name = j.company.split(/\s+[—|–]\s+|\s+-\s+/)[0].replace(/\s*\(.*$/, '').trim();
    if (name.length < 2 || name.length > 50) continue; // free-text "company" fields from posts / HN threads
    const k = dirKey(name);
    if (!k) continue;
    if (!map.has(k)) {
      const host = (() => { try { return new URL(j.url).hostname; } catch { return ''; } })();
      const ats = /greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|myworkdayjobs/.test(host);
      put(base(name, ats ? j.url.replace(/(\.com|\.io|\.co)\/([^/]+).*/, '$1/$2') : `https://www.google.com/search?q=${encodeURIComponent(`${name} careers`)}`, ats ? 'ats' : 'search', `Seen in job feeds (${j.sources[0] || 'feed'})`));
    }
    const c = map.get(k)!;
    const fde = j.categories.includes('FDE');
    if (fde) c.fde++;
    if (j.categories.includes('AIML')) c.aiml++;
    if (j.locTags.includes('BLR')) c.blr++;
    if (j.locTags.includes('REMOTE_IN')) c.remoteIn++;
    const t = j.postedAt || j.firstSeen;
    if (Date.now() - Date.parse(j.firstSeen) < 864e5) c.new24h++;
    if (!c.latest || Date.parse(t) > Date.parse(c.latest)) c.latest = t;
    if (!c.roles.some((x) => x.url === j.url)) c.roles.unshift({ title: j.title, url: j.url, location: j.location, posted: j.postedAt || null, fde });
  }
  // agent: companies / careers pages it discovered
  for (const f of Object.values(findsH)) {
    if ((f.kind !== 'company' && f.kind !== 'careers_page') || f.status === 'dismissed' || !f.company || AGGREGATOR.test(f.company)) continue;
    put(base(f.company, f.ats ? atsCareersUrl({ ats: f.ats.ats, slug: f.ats.slug }) : f.url, f.ats ? 'ats' : 'careers page', 'Found by AI agent', { ats: f.ats?.ats }));
  }
  const companies = [...map.values()].map((c) => {
    const h = hist[c.key];
    const roles = c.roles.sort((a, b) => Number(b.fde) - Number(a.fde) || Date.parse(b.posted || '1970') - Date.parse(a.posted || '1970')).slice(0, 8);
    const fdeRoles = c.fde || roles.filter((r) => r.fde).length;
    return { ...c, fde: fdeRoles, roles, firstSeen: h?.firstSeen || c.firstSeen, lastFdeSeen: h?.lastFdeSeen, hiresFde: c.hiresFde || fdeRoles > 0 || Boolean(h?.lastFdeSeen) };
  });
  companies.sort((a, b) => b.fde - a.fde || b.new24h - a.new24h || b.aiml - a.aiml || Date.parse(b.latest || '1970') - Date.parse(a.latest || '1970'));
  const counts = {
    total: companies.length, hiringNow: companies.filter((c) => c.fde + c.aiml > 0 || c.roles.length > 0).length, fdeNow: companies.filter((c) => c.fde > 0).length,
    hiresFde: companies.filter((c) => c.hiresFde).length, newStartups: companies.filter((c) => c.newStartup).length, new24h: companies.filter((c) => c.new24h > 0).length,
    blr: companies.filter((c) => c.blr > 0).length,
  };
  return { companies, at: now, counts };
}
