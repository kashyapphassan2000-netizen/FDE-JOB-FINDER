import type { CompanyEntry } from './types';
import { atsFromUrl, guessAts, probe } from './atsdetect';
import { getSettings, saveSettings } from './settings';
import { getJobs } from './refresh';
import { hgetall } from './store';
import { classify } from './classify';
import { atsCareersUrl, dirKey } from './directory';
import { webSearch } from './search';

/**
 * Watch any company: paste a name or a careers / job URL.
 *  1. Public ATS board (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday) → polled on every refresh (fast, exact).
 *  2. Otherwise its own careers page → read by the AI careers-page reader in rotation.
 */
export async function addWatch(input: string, careersUrl?: string): Promise<{ kind: 'ats' | 'page'; name: string; url: string; roles: number; fdeAi: number; note: string }> {
  const s = await getSettings();
  const raw = input.trim();
  if (!raw) throw new Error('Type a company name or paste its careers / job link');
  const url = /^https?:\/\//i.test(raw) ? raw : careersUrl && /^https?:\/\//i.test(careersUrl) ? careersUrl : '';
  let name = url ? '' : raw;
  // 1) URL that is already an ATS board / job
  let det = url ? atsFromUrl(url) : null;
  let found = det ? await probe(det.ats, det.slug, name || det.slug) : null;
  // 2) name → guess the ATS slug
  if (!found && name) found = await guessAts(name).catch(() => null);
  // 3) name → find its careers page on the web and check it for an ATS link
  let pageUrl = url;
  if (!found && !pageUrl && name) {
    const r = await webSearch(`${name} careers jobs`, 8, 'any').catch(() => null);
    const hit = r?.results.find((x) => atsFromUrl(x.url)) || r?.results.find((x) => /career|jobs|join|work-with-us/i.test(x.url));
    if (hit) {
      det = atsFromUrl(hit.url);
      found = det ? await probe(det.ats, det.slug, name) : null;
      if (!found) pageUrl = hit.url;
    }
  }
  if (found) {
    name = name || found.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    const entry: CompanyEntry = { ats: found.ats, slug: found.slug, name };
    if (!s.extraCompanies.some((c) => c.ats === entry.ats && c.slug === entry.slug)) await saveSettings({ extraCompanies: [...s.extraCompanies, entry] });
    const rel = found.jobs.filter((j) => classify(j).length).length;
    return { kind: 'ats', name, url: atsCareersUrl(entry), roles: found.total, fdeAi: rel, note: `Found its ${found.ats} board: ${found.total} open roles (${rel} FDE / AI-ML). Checked on every refresh (~2 h) from now on.` };
  }
  if (!pageUrl) throw new Error(`Could not find a careers page for “${raw}”. Paste the careers page link instead.`);
  if (!name) { try { name = new URL(pageUrl).hostname.replace(/^(www|careers|jobs)\./, '').split('.')[0]; name = name[0].toUpperCase() + name.slice(1); } catch { name = pageUrl; } }
  const pages = s.extraCareerPages || [];
  if (!pages.some(([, u]) => u === pageUrl)) await saveSettings({ extraCareerPages: [...pages, [name, pageUrl]] });
  return { kind: 'page', name, url: pageUrl, roles: 0, fdeAi: 0, note: 'No public job board found — its careers page is now read by the AI reader (a few pages per refresh, rotating). First results appear within a few hours.' };
}

export async function removeWatch(kind: 'ats' | 'page', id: string) {
  const s = await getSettings();
  if (kind === 'ats') await saveSettings({ extraCompanies: s.extraCompanies.filter((c) => `${c.ats}:${c.slug}` !== id) });
  else await saveSettings({ extraCareerPages: (s.extraCareerPages || []).filter(([, u]) => u !== id) });
}

export async function listWatch() {
  const [s, jobs, cp] = await Promise.all([getSettings(), getJobs(), hgetall<{ at: string; ok: boolean; roles?: number; mine?: number; error?: string }>('cp:status')]);
  const per = new Map<string, { n: number; fde: number; latest: string | null }>();
  for (const j of jobs) {
    const k = dirKey(j.company);
    const e = per.get(k) || { n: 0, fde: 0, latest: null };
    e.n++;
    if (j.categories.includes('FDE')) e.fde++;
    const t = j.postedAt || j.firstSeen;
    if (!e.latest || t > e.latest) e.latest = t;
    per.set(k, e);
  }
  const ats = s.extraCompanies.map((c) => ({ kind: 'ats' as const, id: `${c.ats}:${c.slug}`, name: c.name, url: atsCareersUrl(c), via: c.ats, ...(per.get(dirKey(c.name)) || { n: 0, fde: 0, latest: null }) }));
  const pages = (s.extraCareerPages || []).map(([name, url]) => ({ kind: 'page' as const, id: url, name, url, via: 'AI page reader', ...(per.get(dirKey(name)) || { n: 0, fde: 0, latest: null }), status: cp[name] || null }));
  return { items: [...ats, ...pages], total: ats.length + pages.length };
}
