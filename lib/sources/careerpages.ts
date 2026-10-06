import type { RawJob, SourceDef } from '../types';
import { secret } from '../secrets';
import { pool } from '../http';
import { atsFromUrl, guessAts, probe } from '../atsdetect';
import { classify, locationAllowed, locationTags } from '../classify';
import { aiConfigured, chatJson } from '../llm';
import { readPage } from '../search';
import { getJSON, hgetall, hset, setJSON } from '../store';

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
  ['Krutrim', 'https://www.instahyre.com/jobs-at-krutrim/'], ['AI4Bharat', 'https://ai4bharat.iitm.ac.in/careers'], ['Yellow.ai', 'https://careers.yellow.ai/jobs/Careers'],
  ['Gnani.ai', 'https://gnani.ai/careers/'], ['Qure.ai', 'https://career.qure.ai/jobs/Careers'], ['Skit.ai', 'https://skit.ai/careers'],
  ['Dolby', 'https://jobs.dolby.com/careers?location=Bangalore'], ['Uber', 'https://www.uber.com/us/en/careers/list/?location=IND-Karnataka-Bangalore'],
  ['Zoho', 'https://careers.zohocorp.com/jobs/Careers'], ['NatWest Group', 'https://jobs.natwestgroup.com/search/?locationsearch=India'],
  ['Walmart Global Tech', 'https://careers.walmart.com/results?q=machine%20learning&page=1&sort=rank&jobState=KA'],
  ['Goldman Sachs', 'https://higher.gs.com/results?LOCATION=Bengaluru&page=1&sort=RELEVANCE'], ['Juspay', 'https://juspay.io/careers'],
  // AI infra / remote employers (CONSOLIDATED_AI_INFRA_COMPANIES, REMOTE_GENUINE_EMPLOYERS_INDIA)
  ['Weights & Biases', 'https://wandb.ai/site/careers'],
  ['Qdrant', 'https://qdrant.tech/careers/'],
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

/** Read a careers page; if it lists no roles, follow up to 3 "open positions / search jobs" links on it (one hop). */
export async function readRoles(name: string, url: string): Promise<{ jobs: RawJob[]; url: string; md: string }> {
  const md = await readPage(url, 30000);
  if (!md || md.length < 300) throw new Error('page is empty to readers (login wall or heavy JavaScript)');
  const jobs = await extract(name, url, md);
  if (jobs.length) return { jobs, url, md };
  const host = new URL(url).hostname.split('.').slice(-2).join('.');
  const links = [...md.matchAll(/\[([^\]]{2,80})\]\((https?:\/\/[^)\s]+)\)/g)]
    .filter(([, text, u]) => /job|position|opening|role|vacanc|search|explore|see all|view all|career/i.test(`${text} ${u}`) && u.includes(host) && u.split('#')[0] !== url.split('#')[0])
    .map(([, , u]) => u).filter((u, i, a) => a.indexOf(u) === i).slice(0, 3);
  for (const u of links) {
    try {
      const md2 = await readPage(u, 30000);
      const j2 = md2.length > 300 ? await extract(name, u, md2) : [];
      if (j2.length) return { jobs: j2, url: u, md: md2 };
    } catch {}
  }
  return { jobs: [], url, md };
}


/** Verified by hand: these "custom" careers sites are really public ATS boards → exact JSON, no AI reading needed. */
const KNOWN: Record<string, [RawAts, string]> = { Outlier: ['greenhouse', 'scaleai'], Turing: ['greenhouse', 'turing'], Alignerr: ['greenhouse', 'labelbox'], Mindrift: ['greenhouse', 'toloka'], 'Handshake AI': ['greenhouse', 'handshake'], PhonePe: ['smartrecruiters', 'PHONEPELIMITED'], Qdrant: ['ashby', 'qdrant.tech'], Automattic: ['greenhouse', 'automatticcareers'], 'Weights & Biases': ['greenhouse', 'coreweave'] };

/** Render the page in a real browser (Firecrawl, ~1 credit) and look for the job board it embeds. */
async function renderedAts(url: string, name: string) {
  const key = secret('FIRECRAWL_API_KEY');
  if (!key) return null;
  const r = await fetch('https://api.firecrawl.dev/v2/scrape', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, formats: ['links', 'html'], waitFor: 4000, onlyMainContent: false }), signal: AbortSignal.timeout(60000) });
  if (!r.ok) return null;
  const d = await r.json();
  const links: string[] = [...(d?.data?.links || []), ...((String(d?.data?.html || '').match(/https?:\/\/[^\s"'<>)]+/g)) || [])];
  const seen = new Set<string>();
  for (const l of links) {
    const a = atsFromUrl(l);
    const k = a && `${a.ats}:${a.slug}`;
    if (!a || !k || seen.has(k)) continue;
    seen.add(k);
    const p = await probe(a.ats, a.slug, name);
    if (p) return p;
    if (seen.size > 4) break;
  }
  return null;
}

/** One-time mapping per company (re-checked every 14 days): its ATS JSON board if it has one, else the real listing page. */
type CpMap = { kind: 'ats'; ats: RawAts; slug: string; at: string } | { kind: 'page'; url: string; at: string } | { kind: 'none'; at: string; why: string };
type RawAts = Parameters<typeof probe>[0];
async function mapCompany(name: string, url: string): Promise<CpMap & { jobs?: RawJob[] }> {
  const at = new Date().toISOString();
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const g = await guessAts(name).catch(() => null);
  if (g && g.slug.replace(/[^a-z0-9]/g, '').includes(key.slice(0, Math.min(6, key.length)))) return { kind: 'ats', ats: g.ats, slug: g.slug, at, jobs: g.jobs };
  let why = '';
  try {
    const r = await readRoles(name, url);
    const link = (r.md.match(/https?:\/\/[^\s)"']+/g) || []).map((u) => atsFromUrl(u)).find(Boolean);
    if (link) { const p = await probe(link.ats, link.slug, name); if (p) return { kind: 'ats', ats: p.ats, slug: p.slug, at, jobs: p.jobs }; }
    if (r.jobs.length) return { kind: 'page', url: r.url, at, jobs: r.jobs };
    why = 'page opens but shows no job list (search widget / login wall)';
  } catch (e) {
    why = (e as Error).message.slice(0, 120);
  }
  // the page renders its jobs with JavaScript → a real browser (Firecrawl) shows the hidden ATS board behind it (e.g. Postman → Workday)
  const hidden = await renderedAts(url, name).catch(() => null);
  if (hidden) return { kind: 'ats', ats: hidden.ats, slug: hidden.slug, at, jobs: hidden.jobs };
  return { kind: 'none', at, why };
}

export const CAREER_PAGE_SOURCE: SourceDef = {
  id: 'careerpages',
  name: 'Company career pages (AI reader)',
  group: 'ATS (company careers)',
  keyless: true,
  envKeys: [],
  defaultIntervalMin: 45,
  covers: `${CAREER_PAGES.length} companies from the Excel with custom careers sites (PhonePe, Flipkart, Atlassian, Postman, Krutrim, W&B, Groq, micro1, Crossover…): each mapped once to its ATS JSON board when it has one (all checked every run), otherwise to its real listing page (AI reader, 4 per run)`,
  docs: 'Jina Reader renders the page (free, rate-limited); an AI provider extracts the roles (Gemini/Groq free tiers are enough)',
  run: async (ctx) => {
    const map = await hgetall<CpMap>('cp:map');
    for (const [n, [ats, slug]] of Object.entries(KNOWN)) if (!map[n] || map[n].kind !== 'ats') map[n] = { kind: 'ats', ats, slug, at: new Date().toISOString() };
    const all: [string, string][] = [...(ctx.settings.extraCareerPages || []), ...CAREER_PAGES];
    const fresh = (m?: CpMap) => m && Date.now() - Date.parse(m.at) < (m.kind === 'none' ? 7 : 14) * 864e5;
    const out: RawJob[] = [];
    const warnings: string[] = [];
    const at = new Date().toISOString();
    const keep = (name: string, jobs: RawJob[]) => { const mine = jobs.map((j) => ({ ...j, company: name })).filter((j) => classify(j).length && locationAllowed(locationTags(j), j.location)); out.push(...mine); return mine.length; };
    // 1) every company already mapped to an ATS → exact JSON, all of them, every run (fast)
    const atsCos = all.filter(([n]) => fresh(map[n]) && map[n].kind === 'ats');
    const r1 = await pool(atsCos, 6, async ([n]) => { const m = map[n] as Extract<CpMap, { kind: 'ats' }>; const p = await probe(m.ats, m.slug, n); return { n, jobs: p?.jobs || [] }; });
    for (const r of r1) if (r.status === 'fulfilled') await hset('cp:status', r.value.n, { at, ok: true, via: 'ats', roles: r.value.jobs.length, mine: keep(r.value.n, r.value.jobs) });
    // 2) map up to 2 unmapped / stale companies this run (rotating)
    const todo = ctx.signal.aborted ? [] : all.filter(([n]) => !fresh(map[n])).slice(0, 2);
    const r2 = await pool(todo, 2, async ([n, u]) => ({ n, m: await mapCompany(n, u) }));
    for (const r of r2) {
      if (r.status !== 'fulfilled') continue;
      const { n, m } = r.value;
      const { jobs, ...save } = m;
      await hset('cp:map', n, save);
      const mine = jobs ? keep(n, jobs) : 0;
      await hset('cp:status', n, m.kind === 'none' ? { at, ok: false, error: m.why } : { at, ok: true, via: m.kind, roles: jobs?.length || 0, mine });
    }
    // 3) mapped listing pages (no ATS): 4 per run, rotating, AI reader
    const pages = all.filter(([n]) => fresh(map[n]) && map[n].kind === 'page');
    const cursor = await getJSON<number>('cp:cursor', 0);
    const batch = pages.length ? Array.from({ length: Math.min(4, pages.length) }, (_, i) => pages[(cursor + i) % pages.length]) : [];
    await setJSON('cp:cursor', pages.length ? (cursor + batch.length) % pages.length : 0);
    const r3 = await pool(batch, 2, async ([n]) => { const u = (map[n] as Extract<CpMap, { kind: 'page' }>).url; const md = await readPage(u, 30000); if (!md || md.length < 200) throw new Error(`${n}: empty page`); return { n, jobs: await extract(n, u, md) }; });
    for (let i = 0; i < r3.length; i++) {
      const r = r3[i];
      if (r.status === 'fulfilled') await hset('cp:status', r.value.n, { at, ok: true, via: 'page', roles: r.value.jobs.length, mine: keep(r.value.n, r.value.jobs) });
      else warnings.push(`${batch[i][0]}: ${(r.reason as Error).message.slice(0, 80)}`);
    }
    const none = all.filter(([n]) => map[n]?.kind === 'none').length;
    if (none) warnings.push(`${none} companies have no readable job list (search widgets / login walls) — use 📥 Capture or paste their job-search link in Watch companies`);
    if (ctx.signal.aborted) warnings.push('time budget reached');
    return Object.assign(out, { warnings });
  },
};
