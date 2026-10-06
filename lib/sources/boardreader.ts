import type { RawJob, SourceDef } from '../types';
import { pool } from '../http';
import { readPage } from '../search';
import { aiConfigured, chatJson } from '../llm';
import { relativeToIso } from '../http';
import { getJSON, hset, setJSON } from '../store';

/**
 * Excel boards the app used to mark "login only / blocks servers" but that a page reader CAN see
 * (verified 2026-10-06 with r.jina.ai: Naukri, Indeed India, Shine, Wellfound, Glassdoor, Cutshort, Apna, Freshersworld,
 * Remote.co, Arc.dev, RemoteRocketship, startup.jobs, Working Nomads, Jobgether, JustRemote, job.careers, AI-training gig boards…).
 * Each run reads a rotating handful with YOUR search words in the board's own search link; AI pulls out every job with its link.
 * Status per board is stored in 'cp:status' as `br:<host>` so the Excel coverage map shows what really works.
 */
export const BOARDS: [name: string, host: string, url: string][] = [
  ['Naukri', 'naukri.com', 'https://www.naukri.com/{qslug}-jobs-in-bengaluru?jobAge=3'],
  ['Indeed India', 'in.indeed.com', 'https://in.indeed.com/jobs?q={q}&l=India&fromage=3'],
  ['Shine', 'shine.com', 'https://www.shine.com/job-search/{qslug}-jobs'],
  ['Wellfound', 'wellfound.com', 'https://wellfound.com/jobs?query={q}'],
  ['Glassdoor India', 'glassdoor.co.in', 'https://www.glassdoor.co.in/Job/india-{qslug}-jobs-SRCH_IL.0,5_IN115_KO6,40.htm'],
  ['Cutshort', 'cutshort.io', 'https://cutshort.io/jobs/{qslug}-jobs'],
  ['Apna', 'apna.co', 'https://apna.co/jobs?search=true&text={q}'],
  ['Freshersworld', 'freshersworld.com', 'https://www.freshersworld.com/jobs/jobsearch/{qslug}-jobs'],
  ['Working Nomads', 'workingnomads.com', 'https://www.workingnomads.com/remote-machine-learning-jobs'],
  ['Jobgether', 'jobgether.com', 'https://jobgether.com/search-offers?keyword={q}'],
  ['JustRemote', 'justremote.co', 'https://justremote.co/remote-developer-jobs'],
  ['Jaabz', 'jaabz.com', 'https://jaabz.com/jobs?search={q}'],
  ['Remote.co', 'remote.co', 'https://remote.co/remote-jobs/search/?search_keywords={q}'],
  ['RemoteRocketship', 'remoterocketship.com', 'https://www.remoterocketship.com/?jobTitle={q}'],
  ['startup.jobs', 'startup.jobs', 'https://startup.jobs/?q={q}'],
  ['Arc.dev', 'arc.dev', 'https://arc.dev/remote-jobs?search={q}'],
  ['job.careers', 'job.careers', 'https://job.careers'],
  ['NoDesk AI', 'nodesk.co', 'https://nodesk.co/remote-jobs/ai/'],
  ['KDnuggets Jobs', 'kdnuggets.com', 'https://www.kdnuggets.com/jobs'],
  ['RemoteBharat', 'remotebharat.com', 'https://remotebharat.com'],
  ['AIGigJobs', 'aigigjobs.com', 'https://aigigjobs.com/locations/india'],
  ['AITrainingJobs', 'aitrainingjobsfinder.com', 'https://aitrainingjobsfinder.com'],
  ['OpenTrain.ai', 'opentrain.ai', 'https://opentrain.ai/jobs'],
  ['DataAnnotation', 'dataannotation.tech', 'https://dataannotation.tech'],
  ['Surge AI', 'surgehq.ai', 'https://surgehq.ai/careers'],
  ['Reddit r/MLjobs', 'reddit.com', 'https://www.reddit.com/r/MLjobs/new/'],
  ['Reddit r/developersIndia', 'reddit.com', 'https://www.reddit.com/r/developersIndia/search/?q=hiring&sort=new&t=week'],
];
const PER_RUN = 6;

/** A job BOARD lists many companies: AI returns every listing with its own company, place, posted time and link. */
async function extractBoard(board: string, url: string, md: string, q: string): Promise<RawJob[]> {
  if (!(await aiConfigured())) throw new Error('needs an AI provider to read boards');
  const { data } = await chatJson<{ jobs: { title: string; company: string; location: string; posted: string; url: string; salary: string }[] }>(
    'You list the job postings on a job-board search results page. Never invent a job: only listings visible in the page, with their exact link from the page.',
    `Board: ${board}\nSearch: ${q}\nPage: ${url}\n---\n${md.slice(0, 16000)}\n---\nList every job listing relevant to "${q}" (or close AI / ML / software roles). JSON: {"jobs":[{"title":"","company":"","location":"city/country or Remote","posted":"as shown, e.g. 2 days ago","url":"absolute link to the listing","salary":"if shown"}]}`,
    { maxTokens: 2500, timeoutMs: 60000 },
  );
  return (data?.jobs || []).filter((j) => j.title && j.company).map((j) => ({
    title: j.title, company: j.company, location: j.location || '', url: /^https?:/.test(j.url) ? j.url : url,
    postedAt: relativeToIso(j.posted || null) || null, salary: j.salary || undefined, description: `via ${board}`,
  }));
}

export const BOARD_READER_SOURCE: SourceDef = {
  id: 'boardreader',
  name: 'Job boards via page reader (Naukri, Indeed, Shine, Wellfound, Glassdoor, Cutshort, Remote.co, Arc.dev…)',
  group: 'Job boards',
  keyless: true,
  envKeys: [],
  defaultIntervalMin: 50,
  covers: `${BOARDS.length} Excel boards that block plain servers but render for a page reader — read in rotation (${PER_RUN} per run, each every few hours) with your search words; AI extracts every job + link`,
  docs: 'Jina Reader (free key) renders the board; your AI provider extracts the roles. Boards that change layout or block the reader show as failing in the Excel coverage map.',
  run: async (ctx) => {
    const kws = (ctx.settings.keywords?.length ? ctx.settings.keywords : ['forward deployed engineer', 'AI engineer', 'machine learning engineer']).slice(0, 4);
    const cursor = await getJSON<number>('br:cursor', 0);
    const batch = Array.from({ length: Math.min(PER_RUN, BOARDS.length) }, (_, i) => BOARDS[(cursor + i) % BOARDS.length]);
    await setJSON('br:cursor', (cursor + batch.length) % BOARDS.length);
    const q = kws[Math.floor(cursor / BOARDS.length) % kws.length] || 'machine learning engineer';
    const at = new Date().toISOString();
    const out: RawJob[] = [];
    const warnings: string[] = [];
    const res = await pool(batch, 3, async ([name, host, tpl]) => {
      const url = tpl.replace('{q}', encodeURIComponent(q)).replace('{qslug}', q.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      const md = await readPage(url, 40000);
      if (!md || md.length < 400 || /just a moment|verify you are human|access denied|captcha/i.test(md.slice(0, 3000))) throw new Error('blocked or empty for the reader');
      return { name, host, jobs: await extractBoard(name, url, md, q) };
    });
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      const [name, host] = batch[i];
      if (r.status === 'fulfilled') { out.push(...r.value.jobs); await hset('cp:status', `br:${host}`, { at, ok: true, via: 'reader', roles: r.value.jobs.length }); }
      else { warnings.push(`${name}: ${(r.reason as Error).message.slice(0, 80)}`); await hset('cp:status', `br:${host}`, { at, ok: false, error: (r.reason as Error).message.slice(0, 120) }); }
    }
    return Object.assign(out, { warnings });
  },
};
