import type { RawJob, SourceDef } from '../types';
import { secret } from '../secrets';
import { decodeEntities, getJson, getText, parseRss, pool, relativeToIso, stripHtml, toIso } from '../http';

const AI_QUERIES = ['forward deployed', 'machine learning', 'AI engineer', 'LLM', 'embedded'];

async function multi<T>(items: T[], fn: (t: T) => Promise<RawJob[]>, limit = 3): Promise<RawJob[]> {
  const res = await pool(items, limit, fn);
  const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<RawJob[]>[];
  if (!ok.length && res.length) throw (res[0] as PromiseRejectedResult).reason;
  return ok.flatMap((r) => r.value);
}

export const BOARD_SOURCES: SourceDef[] = [
  {
    id: 'amazon',
    name: 'Amazon / AWS (amazon.jobs)',
    group: 'Big Tech careers',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 0,
    covers: 'Amazon & AWS India + global (incl. AWS GenAI Innovation Center / ProServe FDE-type roles)',
    docs: 'Public JSON behind amazon.jobs search',
    run: (ctx) =>
      multi(['forward deployed', 'machine learning', 'generative AI', 'applied scientist', 'embedded'], async (q) => {
        const d = await getJson<{ jobs: any[] }>(
          `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}&loc_query=India&result_limit=50&sort=recent`,
          { signal: ctx.signal },
        );
        return (d.jobs || []).map((j) => ({
          title: j.title,
          company: 'Amazon',
          location: j.normalized_location || j.location || '',
          url: `https://www.amazon.jobs${j.job_path}`,
          postedAt: toIso(j.posted_date),
          description: stripHtml(j.description_short || j.basic_qualifications || '', 500),
        }));
      }),
  },
  {
    id: 'microsoft',
    name: 'Microsoft Careers (IDC)',
    group: 'Big Tech careers',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 0,
    covers: 'Microsoft India Development Center + global',
    docs: 'Public JSON behind apply.careers.microsoft.com',
    run: (ctx) =>
      multi(['forward deployed', 'machine learning', 'AI engineer', 'applied scientist'], async (q) => {
        const d = await getJson<any>(
          `https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=${encodeURIComponent(q)}&location=India&start=0&sort_by=timestamp`,
          { signal: ctx.signal },
        );
        return (d?.data?.positions || []).map((p: any) => ({
          title: p.name,
          company: 'Microsoft',
          location: (p.locations || []).join(' | '),
          url: `https://apply.careers.microsoft.com${p.positionUrl}`,
          postedAt: toIso(p.postedTs),
          remote: p.workLocationOption === 'remote',
        }));
      }),
  },
  {
    id: 'yc_jobs',
    name: 'Y Combinator Jobs / Work at a Startup',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 0,
    covers: 'ycombinator.com/jobs (same postings as workatastartup.com)',
    docs: 'Public page props (Inertia JSON)',
    run: (ctx) =>
      multi(['location/india', 'role/software-engineer/remote', 'role/software-engineer', 'location/remote'], async (path) => {
        const html = await getText(`https://www.ycombinator.com/jobs/${path}`, { signal: ctx.signal });
        const m = html.match(/data-page="([^"]+)"/);
        if (!m) throw new Error('YC page format changed (data-page missing)');
        const d = JSON.parse(decodeEntities(m[1]));
        return (d?.props?.jobPostings || []).map((j: any) => ({
          title: j.title,
          company: `${j.companyName}${j.companyBatchName ? ` (YC ${j.companyBatchName})` : ''}`,
          location: j.location || '',
          url: j.url?.startsWith('http') ? j.url : `https://www.ycombinator.com${j.url}`,
          postedAt: relativeToIso(j.createdAt ? `${j.createdAt} ago` : null),
          description: `${j.companyOneLiner || ''} ${(j.skills || []).map((s: any) => s.name || s).join(', ')}`.slice(0, 500),
          salary: j.salaryRange || undefined,
          remote: /remote/i.test(j.location || ''),
        }));
      }, 2),
  },
  {
    id: 'instahyre',
    name: 'Instahyre',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 0,
    covers: 'instahyre.com (India)',
    docs: 'Public JSON behind instahyre.com search',
    run: (ctx) => {
      const qs = ['forward deployed', 'machine learning', 'generative ai', 'llm', 'mlops', 'embedded'];
      const locs = ['Bangalore', ''];
      const combos = qs.flatMap((q) => locs.map((l) => [q, l] as const));
      return multi(combos, async ([q, l]) => {
        const d = await getJson<{ objects: any[] }>(
          `https://www.instahyre.com/api/v1/job_search?skills=${encodeURIComponent(q)}${l ? `&location=${encodeURIComponent(l)}` : ''}`,
          { signal: ctx.signal },
        );
        return (d.objects || []).map((j) => ({
          title: j.title || j.candidate_title,
          company: j.employer?.company_name || 'Instahyre employer',
          location: j.locations || '',
          url: j.public_url,
          postedAt: null,
          description: (j.keywords || []).join(', '),
        }));
      }, 3);
    },
  },
  {
    id: 'remotive',
    name: 'Remotive',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 360, // Remotive asks for a light request rate
    covers: 'remotive.com',
    docs: 'https://remotive.com/api-documentation',
    run: (ctx) =>
      multi(['category=ai-ml', 'search=machine%20learning', 'search=forward%20deployed'], async (q) => {
        const d = await getJson<{ jobs: any[] }>(`https://remotive.com/api/remote-jobs?${q}&limit=100`, { signal: ctx.signal });
        return (d.jobs || []).map((j) => ({
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || 'Remote',
          url: j.url,
          postedAt: toIso(j.publication_date),
          description: stripHtml(j.description, 500),
          salary: j.salary || undefined,
          remote: true,
        }));
      }, 1),
  },
  {
    id: 'remoteok',
    name: 'Remote OK',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 60,
    covers: 'remoteok.com',
    docs: 'https://remoteok.com/api (link back required)',
    run: (ctx) =>
      multi(['ai', 'machine-learning', 'embedded'], async (tag) => {
        const d = await getJson<any[]>(`https://remoteok.com/api?tag=${tag}`, { signal: ctx.signal });
        return (d || []).filter((j) => j && j.position).map((j) => ({
          title: j.position,
          company: j.company,
          location: j.location || 'Remote',
          url: j.url,
          postedAt: toIso(j.date || j.epoch),
          description: stripHtml(j.description, 400),
          salary: j.salary_min ? `$${j.salary_min}–${j.salary_max}` : undefined,
          remote: true,
        }));
      }, 1),
  },
  {
    id: 'himalayas',
    name: 'Himalayas',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 0,
    covers: 'himalayas.app',
    docs: 'https://himalayas.app/api',
    run: (ctx) =>
      multi(['forward deployed engineer', 'machine learning engineer', 'AI engineer', 'MLOps', 'embedded'], async (q) => {
        const d = await getJson<{ jobs: any[] }>(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}`, { signal: ctx.signal });
        return (d.jobs || []).map((j) => ({
          title: j.title,
          company: j.companyName,
          location: (j.locationRestrictions || []).join(', ') || 'Remote (worldwide)',
          url: j.applicationLink || j.guid,
          postedAt: toIso(j.pubDate),
          description: stripHtml(j.excerpt || j.description, 400),
          salary: j.minSalary ? `${j.currency || ''} ${j.minSalary}–${j.maxSalary}` : undefined,
          remote: true,
        }));
      }, 2),
  },
  {
    id: 'jobicy',
    name: 'Jobicy',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 120,
    covers: 'jobicy.com',
    docs: 'https://jobi.cy/apidocs',
    run: (ctx) =>
      multi(['machine%20learning', 'python', 'ai'], async (tag) => {
        const d = await getJson<{ jobs: any[] }>(`https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering&tag=${tag}`, { signal: ctx.signal }).catch(() => ({ jobs: [] }));
        return (d.jobs || []).map((j) => ({
          title: decodeEntities(j.jobTitle),
          company: j.companyName,
          location: j.jobGeo || 'Remote',
          url: j.url,
          postedAt: toIso(j.pubDate),
          description: stripHtml(j.jobExcerpt, 400),
          salary: j.salaryMin ? `${j.salaryCurrency} ${j.salaryMin}–${j.salaryMax}` : undefined,
          remote: true,
        }));
      }, 1),
  },
  {
    id: 'themuse',
    name: 'The Muse',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    optionalEnv: ['THEMUSE_API_KEY'],
    defaultIntervalMin: 120,
    covers: 'themuse.com (Bengaluru + Remote)',
    docs: 'https://www.themuse.com/developers/api/v2 (key optional, raises rate limit)',
    run: (ctx) => {
      const key = secret('THEMUSE_API_KEY') ? `&api_key=${secret('THEMUSE_API_KEY')}` : '';
      const qs = [
        'location=Bengaluru%2C%20India&category=Software%20Engineering',
        'location=Bengaluru%2C%20India&category=Data%20and%20Analytics',
        'location=Flexible%20%2F%20Remote&category=Data%20and%20Analytics',
        'location=Flexible%20%2F%20Remote&category=Software%20Engineering',
      ];
      return multi(qs, async (q) => {
        const d = await getJson<{ results: any[] }>(`https://www.themuse.com/api/public/jobs?page=0&descending=true&${q}${key}`, { signal: ctx.signal });
        return (d.results || []).map((j) => ({
          title: j.name,
          company: j.company?.name || '',
          location: (j.locations || []).map((l: any) => l.name).join(' | '),
          url: j.refs?.landing_page,
          postedAt: toIso(j.publication_date),
          description: stripHtml(j.contents, 400),
        }));
      }, 2);
    },
  },
  {
    id: 'workingnomads',
    name: 'Working Nomads',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 60,
    covers: 'workingnomads.com',
    docs: 'https://www.workingnomads.com/api/exposed_jobs/',
    run: async (ctx) => {
      const d = await getJson<any[]>('https://www.workingnomads.com/api/exposed_jobs/', { signal: ctx.signal });
      return (d || []).map((j) => ({
        title: j.title,
        company: j.company_name,
        location: j.location || 'Remote',
        url: j.url,
        postedAt: toIso(j.pub_date),
        description: `${j.tags || ''} ${stripHtml(j.description, 300)}`,
        remote: true,
      }));
    },
  },
  {
    id: 'weworkremotely',
    name: 'We Work Remotely (RSS)',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 60,
    covers: 'weworkremotely.com',
    docs: 'https://weworkremotely.com/remote-job-rss-feed',
    run: (ctx) =>
      multi(['https://weworkremotely.com/categories/remote-programming-jobs.rss', 'https://weworkremotely.com/remote-jobs.rss'], async (u) => {
        const items = parseRss(await getText(u, { signal: ctx.signal }));
        return items.map((i) => {
          const [company, ...rest] = i.title.split(':');
          return {
            title: rest.join(':').trim() || i.title,
            company: rest.length ? company.trim() : 'WWR',
            location: 'Remote',
            url: i.link,
            postedAt: i.pubDate,
            description: i.description,
            remote: true,
          };
        });
      }, 2),
  },
  {
    id: 'jobspresso',
    name: 'Jobspresso (RSS)',
    group: 'Job boards',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 120,
    covers: 'jobspresso.co',
    docs: 'WordPress job_listing RSS feed',
    run: async (ctx) => {
      const items = parseRss(await getText('https://jobspresso.co/feed/?post_type=job_listing', { signal: ctx.signal }));
      return items.map((i) => {
        const m = i.title.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
        return {
          title: m ? m[1] : i.title,
          company: m ? m[2] : i.author || 'Jobspresso',
          location: 'Remote',
          url: i.link,
          postedAt: i.pubDate,
          description: i.description,
          remote: true,
        };
      });
    },
  },
];
