import type { RawJob, SourceDef } from '../types';
import { getJson, getText, parseRss, pool, relativeToIso, stripHtml, toIso } from '../http';

/**
 * Extra boards from the AI Job Search Master Excel that expose public data:
 * Unstop (India jobs + hiring challenges), Mercor (remote AI contracts), 80,000 Hours (Algolia), NoDesk (remote RSS), Internshala (Bengaluru + WFH).
 */

async function multi<T>(items: T[], fn: (t: T) => Promise<RawJob[]>, limit = 3): Promise<RawJob[]> {
  const res = await pool(items, limit, fn);
  const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<RawJob[]>[];
  if (!ok.length && res.length) throw (res[0] as PromiseRejectedResult).reason;
  return ok.flatMap((r) => r.value);
}

const inr = (n?: number) => (n ? `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)}L` : '');

export const EXTRA_SOURCES: SourceDef[] = [
  {
    id: 'unstop',
    name: 'Unstop jobs',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 120,
    covers: 'unstop.com jobs (India, salary shown) — Excel: NEW_LOW_CROWD_BOARDS',
    docs: 'Public JSON behind unstop.com search',
    run: (ctx) =>
      multi(['machine learning', 'AI engineer', 'generative AI', 'LLM', 'forward deployed', 'data scientist'], async (q) => {
        const d = await getJson<any>(`https://unstop.com/api/public/opportunity/search-result?opportunity=jobs&per_page=30&searchTerm=${encodeURIComponent(q)}&oppstatus=open`, { signal: ctx.signal });
        return (d?.data?.data || []).map((o: any) => {
          const jd = o.jobDetail || {};
          const locs = (o.locations || []).map((l: any) => l.city).filter(Boolean);
          const wfh = /remote|work from home|wfh/i.test(`${jd.type || ''} ${o.workfunction || ''} ${JSON.stringify(o.filters || [])}`);
          return {
            title: o.title,
            company: o.organisation?.name && !/not listed/i.test(o.organisation.name) ? o.organisation.name : 'Unstop listing',
            location: [...locs, wfh ? 'Remote India' : ''].filter(Boolean).join(' | '),
            url: `https://unstop.com/${o.public_url}`,
            postedAt: toIso(o.start_date || o.updated_at || o.created_at),
            salary: jd.max_salary ? (jd.max_salary < 200000 ? `₹${Math.round((jd.min_salary || 0) / 1000)}k–${Math.round(jd.max_salary / 1000)}k/month` : `${inr(jd.min_salary)}–${inr(jd.max_salary)}/yr`).replace(/^₹0k–|^–/, 'up to ') : undefined,
            description: stripHtml(o.details || o.seo_details?.[0]?.description || '', 400),
          } as RawJob;
        });
      }),
  },
  {
    id: 'mercor',
    name: 'Mercor (remote AI contracts)',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 120,
    covers: 'work.mercor.com public listings, India-eligible only — Excel: Talent_Marketplaces (HIGHEST PRIORITY)',
    docs: 'Public JSON behind work.mercor.com',
    run: async (ctx) => {
      const d = await getJson<{ listings: any[] }>('https://aws.api.mercor.com/work/listings-explore-page', { signal: ctx.signal, timeoutMs: 30000 });
      return (d.listings || [])
        .filter((l) => l.status === 'active' && !l.isPrivate && !(l.ineligibleLocation || []).includes('IND') && !(l.ineligibleResidenceLocation || []).includes('IND'))
        .filter((l) => !l.eligibleLocation?.length || l.eligibleLocation.includes('IND'))
        .map((l) => ({
          title: l.title,
          company: l.companyBrandVisible && l.companyName ? `${l.companyName} via Mercor` : 'Mercor',
          location: l.workArrangement === 'remote' || /remote/i.test(l.location || '') ? 'Remote (worldwide, India eligible)' : l.location || '',
          url: `https://work.mercor.com/jobs/${l.listingId}`,
          postedAt: toIso(l.postedAt || l.createdAt),
          salary: l.rateMin ? `$${l.rateMin}${l.rateMax && l.rateMax !== l.rateMin ? `–${l.rateMax}` : ''}/${l.payRateFrequency === 'hourly' ? 'hr' : l.payRateFrequency || 'hr'}` : undefined,
          description: `${l.listingDomain || ''} · ${l.commitment || ''} · ${stripHtml(l.description || '', 350)}`,
          remote: true,
        }));
    },
  },
  {
    id: 'eightyk',
    name: '80,000 Hours job board',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 360,
    covers: 'jobs.80000hours.org — AI safety / ML roles, many remote — Excel: Job_Boards T3',
    docs: 'Public Algolia search key embedded in the site',
    run: (ctx) =>
      multi(['machine learning engineer', 'AI engineer', 'research engineer', 'software engineer AI'], async (q) => {
        const d = await getJson<any>('https://W6KM1UDIB3-dsn.algolia.net/1/indexes/jobs_prod/query', {
          method: 'POST',
          signal: ctx.signal,
          headers: { 'X-Algolia-Application-Id': 'W6KM1UDIB3', 'X-Algolia-API-Key': 'd1d7f2c8696e7b36837d5ed337c4a319', 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, hitsPerPage: 40 }),
        });
        return (d.hits || []).map((h: any) => ({
          title: h.title,
          company: h.company_name || h.company?.name || '80,000 Hours listing',
          location: [...(h.tags_location_80k || h.locations || []), ...(h.remote || /remote/i.test(JSON.stringify(h.tags_location_80k || '')) ? ['Remote'] : [])].join(' | ') || h.card_locations || '',
          url: h.url_external || h.url || `https://jobs.80000hours.org/?jobPk=${h.post_pk}`,
          postedAt: toIso(h.date_published || h.posted_at || (h.date_published_unix ? h.date_published_unix * 1000 : null)),
          description: stripHtml(h.description_short || h.description || '', 400),
        }));
      }),
  },
  {
    id: 'nodesk',
    name: 'NoDesk remote jobs',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 60,
    covers: 'nodesk.co remote jobs RSS — Excel: Job_Boards T3 (remote AI open to India)',
    docs: 'Public RSS',
    run: async (ctx) => {
      const xml = await getText('https://nodesk.co/remote-jobs/index.xml', { signal: ctx.signal });
      return parseRss(xml).map((i) => {
        const [title, company] = i.title.split(/\s+at\s+(?=[^@]+$)/);
        return { title: title || i.title, company: company || 'NoDesk listing', location: `Remote ${i.description.match(/(worldwide|anywhere|global|india|apac|asia)/i)?.[1] || ''}`.trim(), url: i.link, postedAt: i.pubDate, description: i.description.slice(0, 400), remote: true };
      });
    },
  },
  {
    id: 'internshala',
    name: 'Internshala jobs',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 120,
    covers: 'internshala.com full-time ML/AI jobs in Bengaluru + work-from-home — Excel: Hidden_Channels A1',
    docs: 'Public listing pages',
    run: (ctx) =>
      multi(
        [
          ['https://internshala.com/jobs/machine-learning-jobs-in-bangalore/', 'Bengaluru'],
          ['https://internshala.com/jobs/artificial-intelligence-ai-jobs-in-bangalore/', 'Bengaluru'],
          ['https://internshala.com/jobs/work-from-home-machine-learning-jobs/', 'Remote India'],
          ['https://internshala.com/jobs/work-from-home-artificial-intelligence-ai-jobs/', 'Remote India'],
        ] as [string, string][],
        async ([url, loc]) => {
          const html = await getText(url, { signal: ctx.signal });
          return html.split('individual_internship').slice(1).flatMap((b) => {
            const t = b.match(/id="job_title"[^>]*href="([^"]+)"[^>]*>\s*([^<]+)/);
            if (!t || !t[1].startsWith('/job/')) return [];
            const company = b.match(/class="company-name"[^>]*>\s*([^<]+)/)?.[1]?.trim() || 'Internshala listing';
            const sal = b.match(/class="desktop"[^>]*>\s*(₹[^<]+)</)?.[1]?.trim();
            const ago = b.match(/(\d+\s+(?:day|week|hour)s?\s+ago|Today|Just now)/i)?.[1];
            return [{ title: t[2].trim(), company, location: loc, url: `https://internshala.com${t[1]}`, salary: sal, postedAt: ago ? (/today|just/i.test(ago) ? new Date().toISOString() : relativeToIso(ago)) : null } as RawJob];
          });
        },
      ),
  },
];
