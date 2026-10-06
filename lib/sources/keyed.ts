import type { RawJob, SourceDef } from '../types';
import { getJson, http, pool, relativeToIso, stripHtml, toIso } from '../http';

import { secret } from '../secrets';
const env = (k: string) => secret(k);
const num = (k: string, d: number) => Number(process.env[k]) || d;

async function multi<T>(items: T[], fn: (t: T) => Promise<RawJob[]>, limit = 2): Promise<RawJob[]> {
  const res = await pool(items, limit, fn);
  const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<RawJob[]>[];
  if (!ok.length && res.length) throw (res[0] as PromiseRejectedResult).reason;
  return ok.flatMap((r) => r.value);
}

/** Queries used by paid/quota APIs (kept small to stay in free tiers). */
function quotaQueries(ctx: { keywords: string[] }, n: number): string[] {
  const k = ctx.keywords;
  const base = [
    `${k[0] || 'forward deployed engineer'} India`,
    `${k[1] || 'applied AI engineer'} Bengaluru`,
    `${k[3] || 'machine learning engineer'} Bengaluru`,
    `${k[5] || 'embedded AI engineer'} India`,
    `${k[0] || 'forward deployed engineer'} remote`,
  ];
  return base.slice(0, n);
}

function tweetToJob(text: string, url: string, user: string, createdAt: string | null, source: string): RawJob {
  const clean = text.replace(/https?:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const role = clean.match(/(?:hiring|looking for|seeking)\s+(?:an?\s+|our\s+(?:first\s+)?)?([A-Z][\w/+\- ]{3,70}?(?:engineer|developer|scientist|architect|lead|FDE))/i)?.[1];
  const loc = clean.match(/\b(bengaluru|bangalore|india|remote|hyderabad|pune|san francisco|sf|nyc|london|new york)\b/i)?.[1];
  return {
    title: (role || clean).slice(0, 160),
    company: `@${user}`,
    location: loc || '',
    url,
    postedAt: createdAt,
    description: clean.slice(0, 600),
    via: source,
  };
}

export const KEYED_SOURCES: SourceDef[] = [
  {
    id: 'jsearch',
    name: 'JSearch (RapidAPI) — Google for Jobs: LinkedIn, Indeed, Glassdoor, Naukri…',
    group: 'Aggregators (API key)',
    keyless: false,
    envKeys: ['RAPIDAPI_KEY'],
    defaultIntervalMin: num('JSEARCH_INTERVAL_MIN', 720),
    covers: 'LinkedIn, Indeed, Glassdoor, ZipRecruiter, Naukri, Foundit, company sites (via Google for Jobs)',
    docs: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    run: (ctx) =>
      multi(quotaQueries(ctx, num('JSEARCH_QUERIES', 3)), async (q) => {
        const d = await getJson<{ data: any[] }>(
          `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&page=1&num_pages=1&date_posted=today&country=in`,
          { signal: ctx.signal, headers: { 'x-rapidapi-key': env('RAPIDAPI_KEY'), 'x-rapidapi-host': 'jsearch.p.rapidapi.com' } },
        );
        return (d.data || []).map((j) => ({
          title: j.job_title,
          company: j.employer_name,
          location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || j.job_location || '',
          url: j.job_apply_link || j.job_google_link,
          postedAt: toIso(j.job_posted_at_datetime_utc || j.job_posted_at_timestamp),
          description: (j.job_description || '').slice(0, 600),
          remote: Boolean(j.job_is_remote),
          salary: j.job_min_salary ? `${j.job_salary_currency || ''} ${j.job_min_salary}–${j.job_max_salary} ${j.job_salary_period || ''}`.trim() : undefined,
          via: j.job_publisher,
        }));
      }),
  },
  {
    id: 'serpapi',
    name: 'SerpApi — Google Jobs (Naukri, Foundit, Shine, iimjobs, Hirist, Cutshort, Wellfound…)',
    group: 'Aggregators (API key)',
    keyless: false,
    envKeys: ['SERPAPI_KEY'],
    defaultIntervalMin: num('SERPAPI_INTERVAL_MIN', 720),
    covers: 'Every board Google Jobs indexes in India: Naukri, Foundit, Shine, iimjobs, Hirist, Cutshort, Instahyre, Wellfound, Glassdoor, company sites',
    docs: 'https://serpapi.com/google-jobs-api',
    run: (ctx) =>
      multi(quotaQueries(ctx, num('SERPAPI_QUERIES', 4)), async (q) => {
        const d = await getJson<{ jobs_results?: any[]; error?: string }>(
          `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(q)}&gl=in&hl=en&location=India&api_key=${env('SERPAPI_KEY')}`,
          { signal: ctx.signal, timeoutMs: 30000 },
        );
        if (d.error && !/hasn't returned any results/i.test(d.error)) throw new Error(`SerpApi: ${d.error}`);
        return (d.jobs_results || []).map((j) => ({
          title: j.title,
          company: j.company_name,
          location: j.location || '',
          url: j.apply_options?.[0]?.link || j.share_link,
          postedAt: relativeToIso(j.detected_extensions?.posted_at),
          description: (j.description || '').slice(0, 600),
          remote: Boolean(j.detected_extensions?.work_from_home),
          salary: j.detected_extensions?.salary,
          via: (j.via || '').replace(/^via\s+/i, ''),
        }));
      }),
  },
  {
    id: 'adzuna',
    name: 'Adzuna (India)',
    group: 'Aggregators (API key)',
    keyless: false,
    envKeys: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
    defaultIntervalMin: num('ADZUNA_INTERVAL_MIN', 120),
    covers: 'Adzuna India index (Naukri, TimesJobs, Shine, company sites)',
    docs: 'https://developer.adzuna.com/',
    run: (ctx) =>
      multi(ctx.keywords.slice(0, 4), async (q) => {
        const d = await getJson<{ results: any[] }>(
          `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${env('ADZUNA_APP_ID')}&app_key=${env('ADZUNA_APP_KEY')}&results_per_page=50&what=${encodeURIComponent(q)}&max_days_old=2&sort_by=date&content-type=application/json`,
          { signal: ctx.signal },
        );
        return (d.results || []).map((j) => ({
          title: stripHtml(j.title, 200),
          company: j.company?.display_name || '',
          location: j.location?.display_name || '',
          url: j.redirect_url,
          postedAt: toIso(j.created),
          description: stripHtml(j.description, 500),
          salary: j.salary_min ? `₹${Math.round(j.salary_min)}–${Math.round(j.salary_max)}` : undefined,
        }));
      }),
  },
  {
    id: 'jooble',
    name: 'Jooble (India)',
    group: 'Aggregators (API key)',
    keyless: false,
    envKeys: ['JOOBLE_API_KEY'],
    defaultIntervalMin: num('JOOBLE_INTERVAL_MIN', 120),
    covers: 'Jooble India index (Naukri, Indeed, Foundit, Shine, smaller boards)',
    docs: 'https://jooble.org/api/about',
    run: (ctx) =>
      multi(ctx.keywords.slice(0, 4), async (q) => {
        const res = await http(`https://jooble.org/api/${env('JOOBLE_API_KEY')}`, {
          method: 'POST',
          signal: ctx.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: q, location: 'India', page: 1 }),
        });
        const d = (await res.json()) as { jobs: any[] };
        return (d.jobs || []).map((j) => ({
          title: stripHtml(j.title, 200),
          company: j.company || '',
          location: j.location || '',
          url: j.link,
          postedAt: toIso(j.updated),
          description: stripHtml(j.snippet, 500),
          salary: j.salary || undefined,
          via: j.source,
        }));
      }),
  },
  {
    id: 'apify_linkedin',
    retired: 'Off by owner: no LinkedIn job listings',
    name: 'Apify LinkedIn Jobs (curious_coder) — reliable LinkedIn',
    group: 'Aggregators (API key)',
    keyless: false,
    envKeys: ['APIFY_TOKEN'],
    defaultIntervalMin: num('APIFY_INTERVAL_MIN', 720),
    covers: 'linkedin.com/jobs (full details, poster name) — use if the free LinkedIn source gets rate-limited',
    docs: 'https://apify.com/curious_coder/linkedin-jobs-scraper',
    run: async (ctx) => {
      const actor = env('APIFY_LINKEDIN_ACTOR') || 'curious_coder~linkedin-jobs-scraper';
      const token = env('APIFY_TOKEN');
      // 1) read results of the last successful run (instant)
      let items: any[] = [];
      try {
        items = await getJson<any[]>(`https://api.apify.com/v2/acts/${actor}/runs/last/dataset/items?status=SUCCEEDED&clean=true&token=${token}`, { signal: ctx.signal });
      } catch (e) {
        if (!/HTTP 404/.test(String(e))) throw e;
      }
      // 2) kick off a fresh run in the background (results are picked up on the next refresh)
      const urls = ctx.keywords.slice(0, 4).map(
        (k) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(k)}&location=India&f_TPR=r86400`,
      );
      await http(`https://api.apify.com/v2/acts/${actor}/runs?token=${token}`, {
        method: 'POST',
        signal: ctx.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, scrapeCompany: false, limitPerSource: num('APIFY_LINKEDIN_LIMIT', 25) }),
      }).catch(() => undefined);
      return (Array.isArray(items) ? items : []).map((j) => ({
        title: j.title,
        company: j.companyName,
        location: j.location || '',
        url: j.link || j.applyUrl,
        postedAt: toIso(j.postedAt),
        description: (j.descriptionText || '').slice(0, 600),
        salary: j.salary || undefined,
        via: 'LinkedIn',
      }));
    },
  },
  {
    id: 'x_official',
    retired: 'Off by owner: X / LinkedIn posts are checked manually',
    name: 'X (Twitter) official API v2 — recent search',
    group: 'Social (API key)',
    keyless: false,
    envKeys: ['X_BEARER_TOKEN'],
    defaultIntervalMin: num('X_INTERVAL_MIN', 720),
    covers: 'x.com hiring tweets from founders / FDE teams (last 7 days)',
    docs: 'https://developer.x.com/en/portal/dashboard (pay-per-use credits)',
    run: (ctx) =>
      multi(
        [
          '("forward deployed" OR "forward-deployed" OR FDE) (hiring OR "we\'re hiring" OR "join us" OR "apply") -is:retweet lang:en',
          '("AI engineer" OR "ML engineer" OR "applied AI" OR "embedded AI") (hiring) (Bangalore OR Bengaluru OR India OR remote) -is:retweet lang:en',
        ],
        async (q) => {
          const d = await getJson<any>(
            `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=${Math.max(10, num('X_MAX_RESULTS', 10))}&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name`,
            { signal: ctx.signal, headers: { Authorization: `Bearer ${env('X_BEARER_TOKEN')}` } },
          );
          const users = new Map<string, any>((d.includes?.users || []).map((u: any) => [u.id, u]));
          return (d.data || []).map((t: any) => {
            const u = users.get(t.author_id) || { username: 'unknown' };
            return tweetToJob(t.text, `https://x.com/${u.username}/status/${t.id}`, u.username, toIso(t.created_at), 'X');
          });
        },
        1,
      ),
  },
  {
    id: 'twitterapi_io',
    retired: 'Off by owner: X / LinkedIn posts are checked manually',
    name: 'twitterapi.io — cheap X search (alternative to official API)',
    group: 'Social (API key)',
    keyless: false,
    envKeys: ['TWITTERAPI_IO_KEY'],
    defaultIntervalMin: num('TWITTERAPI_IO_INTERVAL_MIN', 120),
    covers: 'x.com hiring tweets (same as above, ~30x cheaper)',
    docs: 'https://twitterapi.io/',
    run: (ctx) =>
      multi(
        [
          '("forward deployed" OR "forward-deployed") (hiring OR "we\'re hiring") -filter:retweets lang:en',
          '("AI engineer" OR "ML engineer" OR "applied AI" OR "embedded AI") hiring (Bangalore OR Bengaluru OR India) -filter:retweets',
        ],
        async (q) => {
          const d = await getJson<{ tweets: any[] }>(
            `https://api.twitterapi.io/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Latest`,
            { signal: ctx.signal, headers: { 'X-API-Key': env('TWITTERAPI_IO_KEY') } },
          );
          return (d.tweets || []).map((t) =>
            tweetToJob(t.text, t.url || `https://x.com/${t.author?.userName}/status/${t.id}`, t.author?.userName || 'unknown', toIso(t.createdAt), 'X'),
          );
        },
        1,
      ),
  },
];
