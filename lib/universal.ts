import { dateFromText, dateFromUrl, FRESH_HOURS, isSocialPost } from './postdate';
import type { RawJob } from './types';
import { DEFAULT_COMPANIES } from './companies';
import { FETCHERS } from './sources/ats';
import { parseLinkedInCards } from './sources/community';
import { getJson, getText, pool, stripHtml, toIso } from './http';
import { locationAllowed, locationTags } from './classify';
import { getJobs } from './refresh';
import { getSettings } from './settings';
import { hgetall } from './store';
import { availableEngines, webSearch } from './search';
import { fetchTweet, tweetIdFromUrl } from './xposts';
import { loadVault } from './secrets';
import type { Find } from './agent';

/**
 * Search ANY role across everything at once: your stored jobs, agent finds, every watched company board (~230),
 * keyword-searchable live boards (LinkedIn, Amazon, Microsoft, Unstop, Remotive, 80,000 Hours, Mercor, JPMorgan),
 * and X / LinkedIn posts + ATS pages through web search. Not limited to FDE/AI roles — whatever you type.
 * Sites that only work logged in come back as pre-filled links for 📥 Capture.
 */
export interface Hit { title: string; company: string; location: string; url: string; postedAt?: string | null; salary?: string; source: string; text?: string }

const words = (q: string) => q.toLowerCase().split(/\s+/).filter((w) => w.length > 1 && !['and', 'or', 'the', 'in', 'at', 'for', 'jobs', 'job', 'role', 'roles'].includes(w));
const matches = (title: string, ws: string[]) => { const t = title.toLowerCase(); return ws.every((w) => t.includes(w.replace(/s$/, ''))); };

type Src = [string, (q: string, signal: AbortSignal) => Promise<RawJob[]>];
const LIVE: Src[] = [
  ['LinkedIn', async (q, signal) => {
    const plans = [['Bengaluru, Karnataka, India', ''], ['India', '&f_WT=2'], ['Worldwide', '&f_WT=2']];
    const r = await pool(plans, 3, async ([loc, x]) => parseLinkedInCards(await getText(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}&location=${encodeURIComponent(loc)}&f_TPR=r604800${x}&sortBy=DD&start=0`, { signal, timeoutMs: 12000 })));
    return r.flatMap((x) => (x.status === 'fulfilled' ? x.value : []));
  }],
  ['Amazon', async (q, signal) => ((await getJson<any>(`https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}&loc_query=India&result_limit=50&sort=recent`, { signal })).jobs || []).map((j: any) => ({ title: j.title, company: 'Amazon', location: j.normalized_location || j.location || '', url: `https://www.amazon.jobs${j.job_path}`, postedAt: toIso(j.posted_date) }))],
  ['Microsoft', async (q, signal) => ((await getJson<any>(`https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=${encodeURIComponent(q)}&location=India&start=0&sort_by=timestamp`, { signal }))?.data?.positions || []).map((p: any) => ({ title: p.name, company: 'Microsoft', location: (p.locations || []).join(' | '), url: `https://apply.careers.microsoft.com${p.positionUrl}`, postedAt: toIso(p.postedTs) }))],
  ['Unstop', async (q, signal) => ((await getJson<any>(`https://unstop.com/api/public/opportunity/search-result?opportunity=jobs&per_page=40&searchTerm=${encodeURIComponent(q)}&oppstatus=open`, { signal }))?.data?.data || []).map((o: any) => ({ title: o.title, company: o.organisation?.name || 'Unstop', location: (o.locations || []).map((l: any) => l.city).join(' | '), url: `https://unstop.com/${o.public_url}`, postedAt: toIso(o.start_date) }))],
  ['Remotive', async (q, signal) => ((await getJson<any>(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`, { signal })).jobs || []).map((j: any) => ({ title: j.title, company: j.company_name, location: j.candidate_required_location || 'Remote', url: j.url, postedAt: toIso(j.publication_date), salary: j.salary || undefined, remote: true }))],
  ['80,000 Hours', async (q, signal) => ((await getJson<any>('https://W6KM1UDIB3-dsn.algolia.net/1/indexes/jobs_prod/query', { method: 'POST', signal, headers: { 'X-Algolia-Application-Id': 'W6KM1UDIB3', 'X-Algolia-API-Key': 'd1d7f2c8696e7b36837d5ed337c4a319', 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, hitsPerPage: 40 }) })).hits || []).map((h: any) => ({ title: h.title, company: h.company_name || '', location: (h.tags_location_80k || []).join(' | '), url: h.url_external || `https://jobs.80000hours.org/?jobPk=${h.post_pk}` }))],
  ['Mercor', async (_q, signal) => ((await getJson<any>('https://aws.api.mercor.com/work/listings-explore-page', { signal, timeoutMs: 25000 })).listings || []).filter((l: any) => l.status === 'active' && !(l.ineligibleLocation || []).includes('IND')).map((l: any) => ({ title: l.title, company: l.companyName ? `${l.companyName} via Mercor` : 'Mercor', location: 'Remote (India eligible)', url: `https://work.mercor.com/jobs/${l.listingId}`, postedAt: toIso(l.postedAt), salary: l.rateMin ? `$${l.rateMin}/hr` : undefined }))],
  ['JPMorgan', async (q, signal) => ((await getJson<any>(`https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=CX_1001,keyword=${encodeURIComponent(q)},limit=50`, { signal }))?.items?.[0]?.requisitionList || []).map((r: any) => ({ title: r.Title, company: 'JPMorgan Chase', location: r.PrimaryLocation || '', url: `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${r.Id}`, postedAt: toIso(r.PostedDate) }))],
];

export function captureLinks(q: string) {
  const e = encodeURIComponent(q);
  const slug = q.trim().toLowerCase().replace(/\s+/g, '-');
  return [
    ['LinkedIn jobs · Bengaluru · 24 h', `https://www.linkedin.com/jobs/search/?keywords=${e}&location=Bengaluru%2C%20Karnataka%2C%20India&f_TPR=r86400&sortBy=DD`],
    ['LinkedIn jobs · remote India', `https://www.linkedin.com/jobs/search/?keywords=${e}&location=India&f_WT=2&f_TPR=r604800&sortBy=DD`],
    ['LinkedIn posts · hiring · 24 h', `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(`hiring "${q}"`)}&datePosted=%22past-24h%22&sortBy=%22date_posted%22`],
    ['X · Latest · hiring', `https://x.com/search?q=${encodeURIComponent(`"${q}" (hiring OR "join us" OR "we're looking") -is:retweet`)}&f=live`],
    ['Naukri · Bengaluru · 3 days', `https://www.naukri.com/${slug}-jobs-in-bangalore?jobAge=3`],
    ['Naukri · work from home', `https://www.naukri.com/${slug}-jobs?wfhType=2&jobAge=7`],
    ['Wellfound', `https://wellfound.com/jobs?query=${e}`],
    ['Hirist', `https://www.hirist.tech/search/${slug}`],
    ['iimjobs', `https://www.iimjobs.com/search/${slug}`],
    ['Foundit · Bengaluru', `https://www.foundit.in/srp/results?query=${e}&locations=Bengaluru`],
    ['Cutshort', `https://cutshort.io/jobs/${slug}-jobs`],
    ['Instahyre', `https://www.instahyre.com/search-jobs/?skills=${e}`],
    ['Indeed India · 3 days', `https://in.indeed.com/jobs?q=${e}&l=Bengaluru&fromage=3`],
    ['Glassdoor India', `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${e}`],
    ['hiring.cafe', `https://hiring.cafe/?searchState=${encodeURIComponent(JSON.stringify({ searchQuery: q }))}`],
    ['Work at a Startup (YC)', `https://www.workatastartup.com/jobs?query=${e}`],
  ].map(([label, url]) => ({ label, url }));
}

export async function universalSearch(q: string, opts: { ignoreLocation?: boolean; budgetMs?: number } = {}) {
  await loadVault();
  const t0 = Date.now();
  const ws = words(q);
  if (!ws.length) throw new Error('Type a role, e.g. “MLOps engineer” or “solutions architect”');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.budgetMs ?? 55000);
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const hits: Hit[] = [];
  const add = (src: string, list: RawJob[], filter = true) => {
    let n = 0;
    for (const j of list) {
      if (!j?.title || !j.url || (filter && !matches(j.title, ws))) continue;
      hits.push({ title: j.title, company: j.company || '', location: j.location || '', url: j.url, postedAt: j.postedAt ?? null, salary: j.salary, source: src, text: j.description?.slice(0, 300) });
      n++;
    }
    counts[src] = (counts[src] || 0) + n;
  };
  try {
    const settings = await getSettings();
    // 1. what you already have
    const [jobs, finds] = await Promise.all([getJobs(), hgetall<Find>('agent:finds')]);
    add('Your job list', jobs);
    add('Agent finds', Object.values(finds).filter((f) => f.kind !== 'company').map((f) => ({ title: f.title, company: f.company || f.author || '', location: f.location, url: f.url, postedAt: dateFromUrl(f.url) || f.postedAt, description: f.snippet })));
    // 2-4 in parallel: live boards, all company ATS boards, web/X/LinkedIn posts
    const companies = [...DEFAULT_COMPANIES, ...settings.extraCompanies].filter((c) => !settings.disabledCompanies.includes(`${c.ats}:${c.slug}`));
    const engines = availableEngines().length;
    const webQueries = engines ? [
      `"${q}" (site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:job-boards.greenhouse.io OR site:apply.workable.com) (Bengaluru OR Bangalore OR remote)`,
      `site:x.com hiring "${q}"`, `site:linkedin.com/posts hiring "${q}" (Bengaluru OR remote OR India)`, `"${q}" hiring Bengaluru OR "remote India" careers`,
    ] : [];
    await Promise.all([
      pool(LIVE, 8, async ([name, fn]) => { try { add(name, await fn(q, ctrl.signal)); } catch (e) { errors.push(`${name}: ${(e as Error).message.slice(0, 60)}`); } }),
      pool(companies, 16, async (c) => {
        if (ctrl.signal.aborted) return;
        try { add(`${c.name} (${c.ats})`, await FETCHERS[c.ats](c, ctrl.signal, [q])); } catch { /* one board down is fine */ }
      }),
      pool(webQueries, 4, async (wq) => {
        const r = await webSearch(wq, 15, 'week');
        const posts: RawJob[] = [];
        await pool(r.results, 6, async (x) => {
          const id = tweetIdFromUrl(x.url);
          const t = id ? await fetchTweet(id) : null;
          const text = t ? t.text : x.snippet;
          posts.push({ title: x.title.slice(0, 160), company: t ? `${t.author} (@${t.handle})` : new URL(x.url).hostname.replace(/^www\./, ''), location: '', url: x.url, postedAt: dateFromUrl(x.url) || t?.createdAt || (isSocialPost(x.url) ? null : x.date) || null, description: text });
        });
        // web hits are kept when the role words appear in the title OR the post text
        for (const p of posts) if (!(p.postedAt && Date.now() - Date.parse(p.postedAt) > 30 * 864e5) && matches(`${p.title} ${p.description}`, ws)) add(/x\.com|twitter/.test(p.url) ? 'X posts' : /linkedin\.com\/posts/.test(p.url) ? 'LinkedIn posts' : 'Web / ATS pages', [p], false);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  // de-dupe + your location rule
  const seen = new Set<string>();
  const out = hits.filter((h) => {
    const k = h.url.split('?')[0];
    if (seen.has(k)) return false;
    seen.add(k);
    if (/\/\/(?:[a-z]+\.)?(?:x|twitter|linkedin)\.com\//i.test(h.url)) { const t = Date.parse(h.postedAt || '') || Date.parse(dateFromText(`${h.title} ${h.text || ''}`) || ''); if (!t || Date.now() - t > FRESH_HOURS * 36e5) return false; } // LinkedIn / X: STRICT 24 h, proven date
    else if (h.postedAt && Date.now() - Date.parse(h.postedAt) > 60 * 864e5) return false;
    if (opts.ignoreLocation || !h.location) return true;
    return locationAllowed(locationTags({ title: h.title, company: h.company, location: h.location, url: h.url }), h.location);
  }).sort((a, b) => Date.parse(b.postedAt || '1970') - Date.parse(a.postedAt || '1970'));
  const bySource = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([source, n]) => ({ source, n }));
  return { q, ms: Date.now() - t0, total: out.length, hits: out.slice(0, 600), bySource, boardsSearched: Object.keys(counts).length, errors: errors.slice(0, 8), captureLinks: captureLinks(q), stripped: hits.length - out.length };
}
export { stripHtml };
