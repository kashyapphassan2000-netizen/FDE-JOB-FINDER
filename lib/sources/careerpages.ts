import type { RawJob, SourceDef } from '../types';
import { pool } from '../http';
import { atsFromUrl, probe } from '../atsdetect';
import { classify, locationAllowed, locationTags } from '../classify';
import { aiConfigured, chatJson } from '../llm';
import { readPage } from '../search';
import { getJSON, hset, setJSON } from '../store';

/**
 * Companies from the Excel that have NO public ATS API (custom careers sites): the page is opened with a
 * JS-rendering reader, embedded ATS links are followed when present, otherwise the AI lists the open
 * FDE / AI-ML roles. Rotates through the list (10 pages per run) so every page is checked several times a day.
 */
export const CAREER_PAGES: [string, string][] = [
  // NEW_DIRECT_CAREERS_BANGALORE
  ['Intuit', 'https://jobs.intuit.com/search-jobs/India'], ['Atlassian', 'https://www.atlassian.com/company/careers/all-jobs?location=India'],
  ['Bloomberg', 'https://bloomberg.avature.net/careers/SearchJobs/?listFilterMode=1&jobOffset=0&817=%5B11007%5D'],
  ['PhonePe', 'https://www.phonepe.com/careers/job-openings/'], ['Zepto', 'https://www.zeptonow.com/careers'], ['Myntra', 'https://careers.myntra.com/job-listing/'],
  ['Ola Electric', 'https://olaelectric.com/careers'], ['Darwinbox', 'https://darwinbox.com/careers'],
  ['Postman', 'https://www.postman.com/company/careers/open-positions/'], ['Zerodha', 'https://careers.zerodha.com/'], ['Flipkart', 'https://www.flipkartcareers.com/#!/joblist'],
  ['Ather Energy', 'https://careers.atherenergy.com/jobs'],
  // Frontier_Labs_India / Hidden_Channels / GCCs without a public API
  ['Krutrim', 'https://www.olakrutrim.com/careers'], ['AI4Bharat', 'https://ai4bharat.iitm.ac.in/careers'], ['Yellow.ai', 'https://yellow.ai/careers/'],
  ['Gnani.ai', 'https://gnani.ai/careers/'], ['Qure.ai', 'https://www.qure.ai/careers'], ['Skit.ai', 'https://skit.ai/careers'],
  ['Dolby', 'https://jobs.dolby.com/careers?location=Bangalore'], ['Uber', 'https://www.uber.com/us/en/careers/list/?location=IND-Karnataka-Bangalore'],
  ['Zoho', 'https://careers.zohocorp.com/jobs/Careers'], ['NatWest Group', 'https://jobs.natwestgroup.com/search/?locationsearch=India'],
  ['Walmart Global Tech', 'https://careers.walmart.com/results?q=machine%20learning&page=1&sort=rank&jobState=KA'],
  ['Goldman Sachs', 'https://higher.gs.com/results?LOCATION=Bengaluru&page=1&sort=RELEVANCE'], ['Juspay', 'https://juspay.io/careers'],
  // AI infra / remote employers (CONSOLIDATED_AI_INFRA_COMPANIES, REMOTE_GENUINE_EMPLOYERS_INDIA)
  ['Weights & Biases', 'https://wandb.ai/site/careers'], ['Replicate', 'https://replicate.com/about#careers'], ['Groq', 'https://groq.com/careers'],
  ['Qdrant', 'https://qdrant.tech/careers/'], ['dstack', 'https://dstack.ai/careers'], ['WhyLabs', 'https://whylabs.ai/careers'],
  ['E2E Networks', 'https://www.e2enetworks.com/careers'], ['Automattic', 'https://automattic.com/work-with-us/jobs/'],
  // Gig / talent platforms (NEW_GIG_TRAINING_PLATFORMS, Talent_Marketplaces)
  ['micro1', 'https://jobs.micro1.ai'], ['Alignerr', 'https://www.alignerr.com/jobs'], ['Crossover', 'https://www.crossover.com/jobs/ai-engineer/in'],
  ['Outlier', 'https://outlier.ai/experts'], ['Mindrift', 'https://mindrift.ai/'], ['Handshake AI', 'https://joinhandshake.com/ai-jobs/'],
  ['Turing', 'https://www.turing.com/jobs'], ['Arc.dev', 'https://arc.dev/remote-jobs/machine-learning'],
];

const ROLE_HINT = /engineer|scientist|machine|learning|\bml\b|\bai\b|llm|genai|deploy|solutions|research|data|mlops|applied/i;
const PER_RUN = 6;

export async function extract(name: string, url: string, md: string): Promise<RawJob[]> {
  const links = [...md.matchAll(/\[([^\]]{3,140})\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => ({ text: m[1].trim(), url: m[2] }));
  // 1. embedded public ATS board → read it properly
  const ats = links.map((l) => atsFromUrl(l.url)).find(Boolean);
  if (ats) {
    const d = await probe(ats.ats, ats.slug, name);
    if (d) return d.jobs.map((j) => ({ ...j, company: name }));
  }
  // 2. AI reads the page
  if (await aiConfigured()) {
    const { data } = await chatJson<{ jobs: { title: string; location: string; url: string }[] }>(
      'You list open job postings from a company careers page. Only Forward Deployed / Solutions / Applied AI and AI-ML / data science / ML engineering roles.',
      `Company: ${name}\nPage: ${url}\n---\n${md.slice(0, 14000)}\n---\nJSON: {"jobs":[{"title":"","location":"city/country or Remote","url":"absolute apply link or the page URL"}]}`,
      { maxTokens: 1800, timeoutMs: 45000 },
    );
    return (data?.jobs || []).filter((j) => j.title).map((j) => ({ title: j.title, company: name, location: j.location || '', url: /^https?:/.test(j.url) ? j.url : url }));
  }
  // 3. no AI: role-looking links
  return links.filter((l) => ROLE_HINT.test(l.text) && !/blog|news|about|life|team|culture/i.test(l.url)).map((l) => ({ title: l.text, company: name, location: '', url: l.url }));
}

export const CAREER_PAGE_SOURCE: SourceDef = {
  id: 'careerpages',
  name: 'Company career pages (AI reader)',
  group: 'ATS (company careers)',
  keyless: true,
  envKeys: [],
  defaultIntervalMin: 45,
  covers: `${CAREER_PAGES.length} companies from the Excel with custom careers sites (PhonePe, Flipkart, Atlassian, Postman, Krutrim, W&B, Groq, micro1, Crossover…); ${PER_RUN} pages per run, rotating`,
  docs: 'Jina Reader renders the page (free, rate-limited); an AI provider extracts the roles (Gemini/Groq free tiers are enough)',
  run: async (ctx) => {
    const cursor = await getJSON<number>('cp:cursor', 0);
    const batch = Array.from({ length: PER_RUN }, (_, i) => CAREER_PAGES[(cursor + i) % CAREER_PAGES.length]);
    await setJSON('cp:cursor', (cursor + PER_RUN) % CAREER_PAGES.length);
    // careers pages YOU added (Watch companies): up to 4 per run, rotating, read before the Excel ones
    const mine = ctx.settings.extraCareerPages || [];
    if (mine.length) {
      const c2 = await getJSON<number>('cp:cursor2', 0);
      const take = Math.min(4, mine.length);
      batch.unshift(...Array.from({ length: take }, (_, i) => mine[(c2 + i) % mine.length]));
      await setJSON('cp:cursor2', (c2 + take) % mine.length);
    }
    const warnings: string[] = [];
    const res = await pool(batch, 3, async ([name, url]) => {
      const md = await readPage(url, 30000);
      if (!md || md.length < 200) throw new Error(`${name}: empty page`);
      return extract(name, url, md);
    });
    const out: RawJob[] = [];
    const at = new Date().toISOString();
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      if (r.status === 'fulfilled') {
        const mine = r.value.filter((j) => classify(j).length && locationAllowed(locationTags(j), j.location));
        out.push(...mine);
        await hset('cp:status', batch[i][0], { at, ok: true, roles: r.value.length, mine: mine.length });
      } else {
        warnings.push(`${batch[i][0]}: ${(r.reason as Error).message.slice(0, 80)}`);
        await hset('cp:status', batch[i][0], { at, ok: false, error: (r.reason as Error).message.slice(0, 120) });
      }
    }
    if (ctx.signal.aborted) warnings.push('time budget reached');
    return Object.assign(out, { warnings });
  },
};
