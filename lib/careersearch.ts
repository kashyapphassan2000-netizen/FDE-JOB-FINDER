import type { CompanyEntry, RawJob } from './types';
import { DEFAULT_COMPANIES } from './companies';
import { FETCHERS } from './sources/ats';
import { getSettings } from './settings';
import { getDiscovered } from './discover';
import { getJSON, hgetall, setJSON } from './store';
import { pool } from './http';
import { atsCareersUrl } from './directory';
import { scoreJob, type Profile } from './relevance';
import { getProfile } from './profile';
import { getJobs } from './refresh';

/**
 * Careers search: EVERY company job board the app knows (built-in ~200 + yours + watched + new startups found daily),
 * fetched straight from the boards' public APIs in one shot (no search-engine quota), then filtered and ranked by YOUR
 * profile: role priority, location priority, experience, exclusions, freshness.
 * The full index is cached for 2 hours (8 compact shards), so searches after a scan are instant.
 */
type Row = [string, string, string, string, string | null, string]; // title, company, location, url, postedAt, snippet
const SHARDS = 8;
const TECH = /engineer|scientist|architect|developer|research|\bai\b|\bml\b|machine learning|data|deploy|solutions?|platform|llm|genai|agent|founding|technical|product manager|consultant|strategist/i;

export async function allBoards(): Promise<CompanyEntry[]> {
  const [s, disc, watch] = await Promise.all([getSettings(), getDiscovered(), hgetall<{ kind: string; ats?: CompanyEntry['ats']; slug?: string; name: string }>('watch:list')]);
  const map = new Map<string, CompanyEntry>();
  const add = (c: CompanyEntry) => { const k = `${c.ats}:${c.slug}`; if (!map.has(k) && !s.disabledCompanies.includes(k)) map.set(k, c); };
  DEFAULT_COMPANIES.forEach(add);
  s.extraCompanies.forEach(add);
  for (const w of Object.values(watch)) if (w.kind === 'ats' && w.ats && w.slug) add({ ats: w.ats, slug: w.slug, name: w.name });
  for (const d of disc) if (d.ats) add({ ats: d.ats.ats, slug: d.ats.slug, name: d.name });
  return [...map.values()];
}

export async function scanAllBoards(budgetMs = 230000): Promise<{ boards: number; ok: number; failed: string[]; jobs: number; ms: number }> {
  const t0 = Date.now();
  const boards = await allBoards();
  const rows: Row[] = [];
  const failed: string[] = [];
  let ok = 0;
  // Workday / SmartRecruiters need search words: use broad AI + FDE words so nothing relevant is missed
  const Q = ['forward deployed', 'machine learning', 'artificial intelligence', 'AI engineer', 'solutions engineer', 'deployment', 'LLM', 'data scientist'];
  await pool(boards, 24, async (c) => {
    if (Date.now() - t0 > budgetMs) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const jobs: RawJob[] = await FETCHERS[c.ats](c, ctrl.signal, Q);
      ok++;
      for (const j of jobs) if (j.title && j.url && TECH.test(j.title)) rows.push([j.title.slice(0, 160), c.name, (j.location || '').slice(0, 120), j.url, j.postedAt || null, (j.description || '').slice(0, 160)]);
    } catch (e) {
      failed.push(`${c.name}: ${(e as Error).message.slice(0, 60)}`);
    } finally { clearTimeout(timer); }
  });
  // + roles read from custom careers pages (AI reader) and big-company portals already in your job feed
  const feed = await getJobs();
  const have = new Set(rows.map((r) => r[3]));
  for (const j of feed) if (!have.has(j.url) && j.sources.some((x) => /careerpages|jpmc|amazon|microsoft|google|workday|oracle/.test(x))) rows.push([j.title.slice(0, 160), j.company, (j.location || '').slice(0, 120), j.url, j.postedAt || null, (j.description || '').slice(0, 160)]);
  const shards: Row[][] = Array.from({ length: SHARDS }, () => []);
  rows.forEach((r, i) => shards[i % SHARDS].push(r));
  await Promise.all(shards.map((sh, i) => setJSON(`cs:idx:${i}`, sh)));
  const meta = { at: new Date().toISOString(), boards: boards.length, ok, failed: failed.slice(0, 40), jobs: rows.length, ms: Date.now() - t0 };
  await setJSON('cs:meta', meta);
  return { boards: boards.length, ok, failed, jobs: rows.length, ms: meta.ms };
}

export interface CsHit { title: string; company: string; location: string; url: string; postedAt: string | null; score: number; roleRank: number; locRank: number; why: string[] }

export async function careersSearch(opts: { q?: string; profile?: Partial<Profile>; refresh?: boolean; limit?: number }) {
  let meta = await getJSON<{ at: string; boards: number; ok: number; failed: string[]; jobs: number; ms: number } | null>('cs:meta', null);
  const stale = !meta || Date.now() - Date.parse(meta.at) > 2 * 36e5;
  if (opts.refresh || stale) { await scanAllBoards(); meta = await getJSON('cs:meta', null); }
  const shards = await Promise.all(Array.from({ length: SHARDS }, (_, i) => getJSON<Row[]>(`cs:idx:${i}`, [])));
  const saved = await getProfile();
  const p: Profile = { ...saved, ...(opts.profile || {}) };
  // a typed search replaces the role list for this search (e.g. "MLOps", "AI product manager")
  if (opts.q?.trim()) p.roles = [opts.q.trim()];
  const hits: CsHit[] = [];
  const seen = new Set<string>();
  for (const sh of shards) for (const [title, company, location, url, postedAt, snippet] of sh) {
    if (seen.has(url)) continue;
    const s = scoreJob({ title, company, location, description: snippet, postedAt }, p);
    if (!s.keep) continue;
    seen.add(url);
    hits.push({ title, company, location, url, postedAt, ...s });
  }
  hits.sort((a, b) => a.roleRank - b.roleRank || a.locRank - b.locRank || Date.parse(b.postedAt || '1970') - Date.parse(a.postedAt || '1970'));
  const byCompany = new Map<string, number>();
  for (const h of hits) byCompany.set(h.company, (byCompany.get(h.company) || 0) + 1);
  return {
    meta, profile: p, total: hits.length, companies: byCompany.size, hits: hits.slice(0, opts.limit || 1500),
    byRole: p.roles.map((r, i) => ({ role: r, n: hits.filter((h) => h.roleRank === i).length })),
    byLocation: [...p.locations, 'Not stated'].map((l, i) => ({ location: l, n: hits.filter((h) => h.locRank === i).length })),
  };
}

export { atsCareersUrl };
