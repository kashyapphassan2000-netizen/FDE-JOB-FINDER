import type { CompanyEntry, RawJob } from './types';
import { FETCHERS } from './sources/ats';
import { pool } from './http';

/** Recognise a company's public ATS board from any URL (job link, careers page link, search result). */
export function atsFromUrl(url: string): { ats: CompanyEntry['ats']; slug: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(h)) {
    const forParam = u.searchParams.get('for');
    if (forParam) return { ats: 'greenhouse', slug: forParam };
    if (seg[0] && !['embed', 'v1'].includes(seg[0])) return { ats: 'greenhouse', slug: seg[0] };
  }
  if (h === 'jobs.lever.co' && seg[0]) return { ats: 'lever', slug: seg[0] };
  if (h === 'jobs.ashbyhq.com' && seg[0]) return { ats: 'ashby', slug: decodeURIComponent(seg[0]) };
  if (h === 'apply.workable.com' && seg[0] && seg[0] !== 'j') return { ats: 'workable', slug: seg[0] };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(h) && seg[0]) return { ats: 'smartrecruiters', slug: seg[0] };
  const wd = h.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const site = seg[0] && /^[a-z]{2}-[A-Z]{2}$/.test(seg[0]) ? seg[1] : seg[0];
    if (site) return { ats: 'workday', slug: `${wd[1]}|${wd[2]}|${site}` };
  }
  return null;
}

/** Slug guesses for a company name: "Sarvam AI" → sarvamai, sarvam-ai, sarvam … */
export function slugGuesses(name: string): string[] {
  const base = name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
  const words = base.split(/\s+/).filter(Boolean);
  const core = words.filter((w) => !['inc', 'llc', 'ltd', 'pvt', 'private', 'limited', 'technologies', 'technology', 'labs', 'ai', 'hq', 'the', 'co'].includes(w));
  const out = [words.join(''), words.join('-'), core.join(''), core.join('-'), `${core.join('')}ai`, `${core.join('')}hq`, `${core.join('')}labs`];
  return Array.from(new Set(out.filter((s) => s.length >= 2))).slice(0, 5);
}

export interface Detected { ats: CompanyEntry['ats']; slug: string; total: number; jobs: RawJob[] }

/** Verify a board exists and return its jobs. */
export async function probe(ats: CompanyEntry['ats'], slug: string, name: string): Promise<Detected | null> {
  try {
    const jobs = await FETCHERS[ats]({ ats, slug, name });
    return jobs.length ? { ats, slug, total: jobs.length, jobs } : null;
  } catch {
    return null;
  }
}

/** Find a company's ATS board by guessing slugs on the 4 big keyless ATSs. */
export async function guessAts(name: string): Promise<Detected | null> {
  const tries = slugGuesses(name).flatMap((slug) => (['greenhouse', 'lever', 'ashby', 'workable'] as const).map((ats) => ({ ats, slug })));
  const res = await pool(tries, 8, (t) => probe(t.ats, t.slug, name));
  let best: Detected | null = null;
  for (const r of res) if (r.status === 'fulfilled' && r.value && (!best || r.value.total > best.total)) best = r.value;
  return best;
}
