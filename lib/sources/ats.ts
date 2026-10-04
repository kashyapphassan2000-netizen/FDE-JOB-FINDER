import type { CompanyEntry, RawJob, SourceContext, SourceDef } from '../types';
import { DEFAULT_COMPANIES } from '../companies';
import { getJson, http, pool, relativeToIso, stripHtml, toIso } from '../http';

export function companiesFor(ats: CompanyEntry['ats'], ctx: SourceContext): CompanyEntry[] {
  const disabled = new Set(ctx.settings.disabledCompanies);
  const all = [...DEFAULT_COMPANIES, ...ctx.settings.extraCompanies];
  const seen = new Set<string>();
  return all.filter((c) => {
    const k = `${c.ats}:${c.slug}`.toLowerCase();
    if (c.ats !== ats || disabled.has(`${c.ats}:${c.slug}`) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Runs fn for each company; one company failing never kills the source. Throws only if ALL fail. */
async function perCompany(list: CompanyEntry[], limit: number, fn: (c: CompanyEntry) => Promise<RawJob[]>): Promise<RawJob[]> {
  const res = await pool(list, limit, fn);
  const out: RawJob[] = [];
  const errors: string[] = [];
  res.forEach((r, i) => {
    if (r.status === 'fulfilled') out.push(...r.value);
    else errors.push(`${list[i].name}: ${(r.reason as Error)?.message || r.reason}`);
  });
  if (list.length && errors.length === list.length) throw new Error(`All ${list.length} companies failed. First: ${errors[0]}`);
  if (errors.length) (out as RawJob[] & { warnings?: string[] }).warnings = errors;
  return out;
}

// ---------- Greenhouse: https://developers.greenhouse.io/job-board.html ----------
export async function fetchGreenhouse(c: CompanyEntry, signal?: AbortSignal): Promise<RawJob[]> {
  const d = await getJson<{ jobs: any[] }>(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs`, { signal });
  return (d.jobs || []).map((j) => ({
    title: j.title,
    company: c.name || j.company_name,
    location: j.location?.name || '',
    url: j.absolute_url,
    postedAt: toIso(j.first_published || j.updated_at),
  }));
}

// ---------- Lever: https://github.com/lever/postings-api ----------
export async function fetchLever(c: CompanyEntry, signal?: AbortSignal): Promise<RawJob[]> {
  const d = await getJson<any[]>(`https://api.lever.co/v0/postings/${c.slug}?mode=json`, { signal });
  return (Array.isArray(d) ? d : []).map((j) => ({
    title: j.text,
    company: c.name,
    location: [j.categories?.location, ...(j.categories?.allLocations || [])].filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(' | '),
    url: j.hostedUrl,
    postedAt: toIso(j.createdAt),
    description: (j.descriptionPlain || '').slice(0, 600),
    remote: j.workplaceType === 'remote',
  }));
}

// ---------- Ashby: https://developers.ashbyhq.com/docs/public-job-posting-api ----------
export async function fetchAshby(c: CompanyEntry, signal?: AbortSignal): Promise<RawJob[]> {
  const d = await getJson<{ jobs: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}?includeCompensation=true`, { signal });
  return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
    title: j.title,
    company: c.name,
    location: [j.location, ...(j.secondaryLocations || []).map((s: any) => s.location)].filter(Boolean).join(' | '),
    url: j.jobUrl,
    postedAt: toIso(j.publishedAt),
    description: (j.descriptionPlain || '').slice(0, 600),
    remote: Boolean(j.isRemote) || j.workplaceType === 'Remote',
    salary: j.compensation?.compensationTierSummary || undefined,
  }));
}

// ---------- Workable ----------
export async function fetchWorkable(c: CompanyEntry, signal?: AbortSignal): Promise<RawJob[]> {
  const d = await getJson<{ jobs: any[] }>(`https://apply.workable.com/api/v1/widget/accounts/${c.slug}`, { signal });
  return (d.jobs || []).map((j) => ({
    title: j.title,
    company: c.name,
    location: [j.city, j.state, j.country].filter(Boolean).join(', ') || (j.locations || []).map((l: any) => [l.city, l.country].filter(Boolean).join(', ')).join(' | '),
    url: j.url || j.shortlink,
    postedAt: toIso(j.published_on || j.created_at),
    remote: Boolean(j.telecommuting),
  }));
}

// ---------- SmartRecruiters: https://developers.smartrecruiters.com/docs/posting-api ----------
const SR_QUERIES = ['forward deployed', 'machine learning', 'artificial intelligence', 'AI engineer', 'embedded'];
export async function fetchSmartRecruiters(c: CompanyEntry, signal?: AbortSignal, queries = SR_QUERIES): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const q of queries) {
    const d = await getJson<{ content: any[] }>(`https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?q=${encodeURIComponent(q)}&limit=100`, { signal });
    for (const j of d.content || []) {
      out.push({
        title: j.name,
        company: c.name,
        location: j.location?.fullLocation || [j.location?.city, j.location?.country].filter(Boolean).join(', '),
        url: `https://jobs.smartrecruiters.com/${c.slug}/${j.id}`,
        postedAt: toIso(j.releasedDate),
        remote: Boolean(j.location?.remote),
      });
    }
  }
  return out;
}

// ---------- Workday (public CXS endpoint used by every *.myworkdayjobs.com site) ----------
const WD_QUERIES = ['forward deployed', 'machine learning', 'artificial intelligence', 'embedded AI', 'deep learning'];
export async function fetchWorkday(c: CompanyEntry, signal?: AbortSignal, queries = WD_QUERIES): Promise<RawJob[]> {
  const [tenant, wdn, site] = c.slug.split('|');
  const base = `https://${tenant}.${wdn}.myworkdayjobs.com`;
  const out: RawJob[] = [];
  for (const q of queries) {
    const res = await http(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: q }),
    });
    const d = (await res.json()) as { jobPostings?: any[] };
    for (const j of d.jobPostings || []) {
      if (!j.title || !j.externalPath) continue;
      out.push({
        title: j.title,
        company: c.name,
        location: j.locationsText || '',
        url: `${base}/${site}${j.externalPath}`,
        postedAt: relativeToIso(j.postedOn),
      });
    }
  }
  return out;
}

export const FETCHERS: Record<CompanyEntry['ats'], (c: CompanyEntry, s?: AbortSignal, queries?: string[]) => Promise<RawJob[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  smartrecruiters: fetchSmartRecruiters,
  workday: fetchWorkday,
};

const mk = (ats: CompanyEntry['ats'], name: string, limit: number, docs: string): SourceDef => ({
  id: ats,
  name,
  group: 'ATS (company careers)',
  keyless: true,
  envKeys: [],
  defaultIntervalMin: 0,
  covers: `Company career pages hosted on ${name}`,
  docs,
  run: (ctx) => perCompany(companiesFor(ats, ctx), limit, (c) => FETCHERS[ats](c, ctx.signal)),
});

export const ATS_SOURCES: SourceDef[] = [
  mk('greenhouse', 'Greenhouse', 10, 'https://developers.greenhouse.io/job-board.html'),
  mk('lever', 'Lever', 8, 'https://github.com/lever/postings-api'),
  mk('ashby', 'Ashby', 10, 'https://developers.ashbyhq.com/docs/public-job-posting-api'),
  mk('workable', 'Workable', 4, 'https://help.workable.com/hc/en-us/articles/115012771647'),
  mk('smartrecruiters', 'SmartRecruiters', 4, 'https://developers.smartrecruiters.com/docs/posting-api'),
  mk('workday', 'Workday (NVIDIA, Intel, Micron, NXP, ADI, Samsung, Hitachi, Cisco…)', 10, 'Public *.myworkdayjobs.com CXS endpoint'),
];

/** Try every ATS for a slug; used by Settings → "Auto-detect company". */
export async function detectCompany(slug: string, name: string): Promise<{ ats: CompanyEntry['ats']; count: number }[]> {
  const tries: CompanyEntry['ats'][] = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters'];
  const res = await pool(tries, 5, async (ats) => ({ ats, count: (await FETCHERS[ats]({ ats, slug, name })).length }));
  return res.flatMap((r) => (r.status === 'fulfilled' && r.value.count > 0 ? [r.value] : []));
}

export { stripHtml };
