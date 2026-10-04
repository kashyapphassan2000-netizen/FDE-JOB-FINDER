import type { RawJob, SourceDef } from '../types';
import { decodeEntities, getJson, getText, HttpError, parseRss, pool, stripHtml, toIso } from '../http';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- LinkedIn public guest jobs endpoint (no login, unofficial) ----------
// Works from most IPs; LinkedIn may rate-limit (429/999) cloud IPs. JSearch / Apify are the paid fallbacks.
export function parseLinkedInCards(html: string): RawJob[] {
  const cards = html.split(/<li[\s>]/).slice(1);
  const out: RawJob[] = [];
  for (const c of cards) {
    const title = c.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    const href = c.match(/base-card__full-link[^>]*href="([^"?]+)/)?.[1] || c.match(/href="(https:\/\/[a-z]+\.linkedin\.com\/jobs\/view\/[^"?]+)/)?.[1];
    if (!title || !href) continue;
    const company = c.match(/base-search-card__subtitle[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] || c.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/)?.[1] || '';
    const location = c.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/)?.[1] || '';
    const dt = c.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const salary = c.match(/job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/)?.[1];
    out.push({
      title: decodeEntities(stripHtml(title, 200)),
      company: decodeEntities(stripHtml(company, 120)),
      location: decodeEntities(stripHtml(location, 120)),
      url: decodeEntities(href),
      postedAt: toIso(dt),
      salary: salary ? stripHtml(salary, 80) : undefined,
    });
  }
  return out;
}

export const COMMUNITY_SOURCES: SourceDef[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn Jobs (public guest search)',
    group: 'Community & social',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 0,
    covers: 'linkedin.com/jobs — last 7 days, India + Remote',
    docs: 'Unofficial public endpoint; if blocked use JSearch or Apify (see PDF)',
    run: async (ctx) => {
      const kws = ctx.keywords.slice(0, 6);
      const plans: { kw: string; loc: string; extra: string }[] = [];
      for (const kw of kws) {
        plans.push({ kw, loc: 'India', extra: '' });
        if (/forward|applied|embedded|edge/i.test(kw)) plans.push({ kw, loc: 'Worldwide', extra: '&f_WT=2' });
      }
      const out: RawJob[] = [];
      let blocked = 0;
      for (const p of plans) {
        for (const start of [0, 25]) {
          const u = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(p.kw)}&location=${encodeURIComponent(p.loc)}&f_TPR=r604800${p.extra}&sortBy=DD&start=${start}`;
          try {
            const html = await getText(u, { signal: ctx.signal, timeoutMs: 12000, headers: { Accept: 'text/html' } });
            const jobs = parseLinkedInCards(html);
            out.push(...jobs);
            if (jobs.length < 10) break;
          } catch (e) {
            if (e instanceof HttpError && (e.status === 429 || e.status === 999 || e.status === 403)) {
              blocked++;
              if (blocked >= 2) break;
            } else throw e;
          }
          await sleep(350);
        }
        if (blocked >= 2) break;
      }
      if (!out.length && blocked) throw new Error('LinkedIn rate-limited this server IP (429/999). Add RAPIDAPI_KEY (JSearch) or APIFY_TOKEN for reliable LinkedIn coverage.');
      return out;
    },
  },
  {
    id: 'hn',
    name: "Hacker News — Who's Hiring",
    group: 'Community & social',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 60,
    covers: 'news.ycombinator.com monthly thread (also what hn.hiring-search.com indexes)',
    docs: 'https://hn.algolia.com/api',
    run: async (ctx) => {
      const stories = await getJson<{ hits: any[] }>('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6', { signal: ctx.signal });
      const story = (stories.hits || []).find((h) => /who is hiring/i.test(h.title));
      if (!story) throw new Error('No current Who is hiring thread found');
      const qs = ['forward deployed', 'machine learning', 'AI engineer', 'LLM', 'embedded', 'India', 'applied AI', 'MLOps'];
      const res = await pool(qs, 3, (q) =>
        getJson<{ hits: any[] }>(`https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&query=${encodeURIComponent(q)}&hitsPerPage=100`, { signal: ctx.signal }),
      );
      const seen = new Set<string>();
      const out: RawJob[] = [];
      for (const r of res) {
        if (r.status !== 'fulfilled') continue;
        for (const h of r.value.hits || []) {
          if (seen.has(h.objectID) || h.parent_id !== Number(story.objectID)) continue;
          seen.add(h.objectID);
          const text = stripHtml(h.comment_text || '', 1200);
          const first = text.split(/\s{2,}|\n/)[0].slice(0, 220);
          const parts = first.split('|').map((s) => s.trim());
          out.push({
            title: parts[1] && parts[1].length < 120 ? parts[1] : first.slice(0, 140),
            company: parts[0]?.slice(0, 80) || 'HN poster',
            location: parts.slice(2, 4).join(' | '),
            url: `https://news.ycombinator.com/item?id=${h.objectID}`,
            postedAt: toIso(h.created_at),
            description: text,
            remote: /remote/i.test(first),
          });
        }
      }
      return out;
    },
  },
  {
    id: 'reddit',
    name: 'Reddit job subreddits (RSS)',
    group: 'Community & social',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 60,
    covers: 'r/MLjobs, r/DataScienceJobs, r/developersIndia, r/mlops, r/forhire (+ yours)',
    docs: 'Public subreddit RSS (reddit.com/r/<sub>/new/.rss)',
    run: async (ctx) => {
      const subs = ctx.settings.subreddits;
      const res = await pool(subs, 2, async (sub) => {
        const items = parseRss(await getText(`https://www.reddit.com/r/${sub}/new/.rss?limit=50`, { signal: ctx.signal, headers: { Accept: 'application/atom+xml' } }));
        return items
          .filter((i) => (sub.toLowerCase() === 'forhire' ? /\[hiring\]/i.test(i.title) : /hiring|job|opening|role|position|looking for/i.test(i.title)))
          .map((i) => ({
            title: i.title.replace(/\[[^\]]+\]/g, '').trim().slice(0, 200),
            company: `Reddit r/${sub}`,
            location: /india|bangalore|bengaluru/i.test(i.title + i.description) ? 'India' : /remote/i.test(i.title + i.description) ? 'Remote' : '',
            url: i.link,
            postedAt: i.pubDate,
            description: i.description,
          }));
      });
      const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<RawJob[]>[];
      if (!ok.length && res.length) throw (res[0] as PromiseRejectedResult).reason;
      return ok.flatMap((r) => r.value);
    },
  },
  {
    id: 'telegram',
    name: 'Telegram job channels',
    group: 'Community & social',
    keyless: true,
    envKeys: [],
    defaultIntervalMin: 30,
    covers: 't.me/AiIndiaJobs (+ any public channel you add in Settings)',
    docs: 'Public channel web preview (t.me/s/<channel>)',
    run: async (ctx) => {
      const res = await pool(ctx.settings.telegramChannels, 3, async (ch) => {
        const html = await getText(`https://t.me/s/${ch}`, { signal: ctx.signal });
        const blocks = html.split('tgme_widget_message_wrap').slice(1);
        return blocks.flatMap((b) => {
          const post = b.match(/data-post="([^"]+)"/)?.[1];
          const raw = b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1];
          if (!post || !raw) return [];
          const text = stripHtml(raw.replace(/<br\s*\/?>/gi, '\n'), 1500);
          const lines = raw.split(/<br\s*\/?>/i).map((l) => stripHtml(l, 200)).filter(Boolean);
          const title = (lines.find((l) => /engineer|developer|scientist|ml|ai|intern|analyst|architect|hiring/i.test(l)) || lines[0] || '').replace(/^.*?\b(we('|’)?re |we are |now )?hiring( for)?\s*[:|\-–]?\s*(an?\s+)?/i, '').replace(/^(an?|the)\s+/i, '').slice(0, 160) || lines[0]?.slice(0, 160) || 'Telegram job post';
          const company = text.match(/(?:company|organisation|organization)\s*[:\-–]\s*([^\n|]{2,60})/i)?.[1] || text.match(/\bat\s+([A-Z][\w.&\- ]{1,40})/)?.[1] || `Telegram @${ch}`;
          const loc = text.match(/location\s*[:\-–]\s*([^\n|]{2,60})/i)?.[1] || (/remote/i.test(text) ? 'Remote' : /india|bangalore|bengaluru/i.test(text) ? 'India' : '');
          const dt = b.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
          return [{ title, company: company.trim(), location: loc.trim(), url: `https://t.me/${post}`, postedAt: toIso(dt), description: text } as RawJob];
        });
      });
      const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<RawJob[]>[];
      if (!ok.length && res.length) throw (res[0] as PromiseRejectedResult).reason;
      return ok.flatMap((r) => r.value);
    },
  },
];
