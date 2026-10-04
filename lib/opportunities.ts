import { getJson, pool, stripHtml, toIso } from './http';
import { getJSON, setJSON } from './store';

/**
 * Non-job routes into a job, from the Excel sheets COMPETITIONS_HACKATHONS, NEW_FAST_HIRE_HACKS ("PPO/Hackathon Fast-Track"),
 * Talent_Marketplaces / NEW_GIG_TRAINING_PLATFORMS, OPENSOURCE_PROGRAMS, CERTIFICATIONS_CREDENTIALS, COMMUNITY_BUILDERS.
 * Live items are refreshed at most every 6 hours.
 */
export interface Opp {
  id: string; kind: 'hackathon' | 'hiring_challenge' | 'contract'; title: string; org: string; url: string; deadline?: string | null; posted?: string | null;
  prize?: string; eligibility: string; openToYou: boolean; tags: string[]; ppi?: boolean; pay?: string;
}

const PRO_OK = /^(all|everyone|anyone|freshers?|(working |experienced )?professionals?|graduates?)$/i;
const AI_RX = /\b(ai|ml|genai|llm|llms|agents?|agentic|machine learning|deep learning|data|vision|nlp|neural|intelligence|gpt|rag)\b/i;

async function unstop(kind: 'hackathons' | 'competitions', q: string): Promise<Opp[]> {
  const d = await getJson<any>(`https://unstop.com/api/public/opportunity/search-result?opportunity=${kind}&per_page=40&oppstatus=open&searchTerm=${encodeURIComponent(q)}`);
  return (d?.data?.data || []).filter((x: any) => AI_RX.test(`${x.title} ${(x.workfunction || []).map?.((w: any) => w.name).join(' ') || ''}`) || kind === 'competitions').map((x: any) => {
    const elig = (x.filters || []).filter((f: any) => f.type === 'eligible').map((f: any) => f.name);
    const blob = JSON.stringify(x).toLowerCase();
    const cash = (x.prizes || []).reduce((a: number, p: any) => a + (Number(p.cash) || 0), 0);
    return {
      id: `unstop:${x.id}`, kind: /hiring/i.test(x.title) || /hiring challenge|recruit/.test(blob) ? 'hiring_challenge' : 'hackathon', title: x.title, org: x.organisation?.name || 'Unstop',
      url: `https://unstop.com/${x.public_url}`, deadline: toIso(x.end_date), posted: toIso(x.start_date), prize: cash ? `₹${cash.toLocaleString('en-IN')}` : undefined,
      eligibility: elig.join(', ') || 'see page', openToYou: !elig.length || elig.some((e: string) => PRO_OK.test(String(e).trim())), tags: [], ppi: /\bppi\b|\bppo\b|pre-placement|interview opportunit|job offer|hiring/.test(blob),
    } as Opp;
  }).filter((o: Opp) => kind === 'hackathons' || o.kind === 'hiring_challenge' || o.ppi);
}

async function devpost(): Promise<Opp[]> {
  const pages = await pool([1, 2], 2, (p) => getJson<any>(`https://devpost.com/api/hackathons?status[]=open&status[]=upcoming&themes[]=Machine%20Learning%2FAI&page=${p}`));
  return pages.flatMap((r) => (r.status === 'fulfilled' ? r.value.hackathons || [] : [])).map((h: any) => ({
    id: `devpost:${h.id}`, kind: 'hackathon', title: h.title, org: h.organization_name || 'Devpost', url: h.url, deadline: null, posted: null,
    prize: stripHtml(h.prize_amount || '', 40) || undefined, eligibility: `${h.displayed_location?.location || 'Online'} · ${h.registrations_count || 0} registered · ${h.submission_period_dates || ''}`,
    openToYou: /online/i.test(h.displayed_location?.location || '') || /bengaluru|bangalore|india/i.test(h.displayed_location?.location || ''), tags: (h.themes || []).map((t: any) => t.name).slice(0, 4),
  }));
}

async function mercor(): Promise<Opp[]> {
  const d = await getJson<{ listings: any[] }>('https://aws.api.mercor.com/work/listings-explore-page', { timeoutMs: 30000 });
  return (d.listings || [])
    .filter((l) => l.status === 'active' && !l.isPrivate && !(l.ineligibleLocation || []).includes('IND') && (!l.eligibleLocation?.length || l.eligibleLocation.includes('IND')))
    .filter((l) => /software|engineer|code|coding|ai|machine|data|ml|python|llm|research|math|stem/i.test(`${l.title} ${l.listingDomain}`))
    .map((l) => ({
      id: `mercor:${l.listingId}`, kind: 'contract', title: l.title, org: l.companyBrandVisible && l.companyName ? l.companyName : 'Mercor client', url: `https://work.mercor.com/jobs/${l.listingId}`,
      posted: toIso(l.postedAt || l.createdAt), pay: l.rateMin ? `$${l.rateMin}${l.rateMax && l.rateMax !== l.rateMin ? `–${l.rateMax}` : ''}/hr` : undefined,
      eligibility: `Remote · India eligible · ${l.commitment || 'flexible'}`, openToYou: true, tags: [l.listingDomain].filter(Boolean),
    } as Opp));
}

export async function getOpportunities(force = false): Promise<{ at: string; items: Opp[]; errors: string[] }> {
  const cached = await getJSON<{ at: string; items: Opp[]; errors: string[] } | null>('opps', null);
  if (!force && cached && Date.now() - Date.parse(cached.at) < 6 * 36e5) return cached;
  const jobs: [string, () => Promise<Opp[]>][] = [
    ['Unstop hackathons', () => unstop('hackathons', 'AI')], ['Unstop ML hackathons', () => unstop('hackathons', 'machine learning')],
    ['Unstop hiring challenges', () => unstop('competitions', 'hiring')], ['Devpost', devpost], ['Mercor', mercor],
  ];
  const res = await pool(jobs, 5, ([, fn]) => fn());
  const errors: string[] = [];
  const seen = new Set<string>();
  const items: Opp[] = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return void errors.push(`${jobs[i][0]}: ${(r.reason as Error).message.slice(0, 100)}`);
    for (const o of r.value) if (!seen.has(o.id)) { seen.add(o.id); items.push(o); }
  });
  const out = { at: new Date().toISOString(), items, errors };
  await setJSON('opps', out);
  return out;
}

/** Static programs from the Excel (always worth knowing; links verified in the workbook). */
export const PROGRAMS: { group: string; items: { name: string; what: string; url: string; note?: string }[] }[] = [
  { group: 'Talent marketplaces (remote, India-eligible)', items: [
    { name: 'Mercor', what: '$60–120/hr top; one 20-min AI video interview; clients OpenAI/Anthropic/Meta', url: 'https://mercor.com', note: 'HIGHEST PRIORITY in your Excel' },
    { name: 'Turing', what: '$100–200/hr senior; English + tech test + live interview', url: 'https://turing.com' },
    { name: 'micro1', what: '$50–150/hr engineering; AI recruiter "Zara" screens', url: 'https://talent.micro1.ai' },
    { name: 'Braintrust', what: '0% commission; Goldman, Nike, Atlassian projects', url: 'https://app.usebraintrust.com' },
    { name: 'Alignerr (Labelbox)', what: 'Up to $150/hr expert AI training', url: 'https://alignerr.com/jobs' },
    { name: 'Handshake AI', what: '$40–125/hr AI reasoning evaluation', url: 'https://www.joinhandshake.ai' },
    { name: 'Arc.dev', what: '$60–100+/hr; AI shortlist in 72 h', url: 'https://arc.dev' },
    { name: 'Crossover', what: 'Full-time remote at US software cos', url: 'https://crossover.com/jobs/ai-engineer/in' },
    { name: 'Gun.io', what: '$60–150/hr; live technical test', url: 'https://gun.io' },
    { name: 'Upwork', what: '$30–80+/hr LLM/RAG gigs → resume bullets', url: 'https://upwork.com' },
  ] },
  { group: 'Open-source programs (contributors get hired)', items: [
    { name: 'Google Summer of Code', what: '~3 months, stipend, 185+ orgs', url: 'https://summerofcode.withgoogle.com' },
    { name: 'LFX Mentorship', what: '12 weeks, $3,000–6,600, CNCF/Kubernetes orgs', url: 'https://mentor.lfx.linuxfoundation.org' },
    { name: 'MLH Fellowship', what: '12 weeks, up to ~$5,000', url: 'https://fellowship.mlh.com' },
    { name: 'Outreachy', what: '3 months, ~$7,000, remote', url: 'https://www.outreachy.org' },
    { name: 'Contribute to LangChain / LlamaIndex / vLLM / Qdrant', what: 'A merged PR → DM the maintainer (Excel "Contributor-to-Hire")', url: 'https://github.com/vllm-project/vllm/issues?q=is%3Aopen+label%3A%22good+first+issue%22' },
  ] },
  { group: 'Skill proof that shortens interview loops', items: [
    { name: 'CodeSignal Certified', what: '4/4 score can replace a coding round', url: 'https://codesignal.com/' },
    { name: 'HackerRank Skills Verification', what: 'Recruiters search badge-holders', url: 'https://www.hackerrank.com/skills-verification' },
    { name: 'Kaggle competitions', what: 'Rank is screened by Google/Microsoft/Amazon Bangalore', url: 'https://www.kaggle.com/competitions' },
    { name: 'AWS ML Specialty / Google PMLE / Azure AI-102', what: 'Cloud AI certs named in JDs', url: 'https://cloud.google.com/certification/machine-learning-engineer' },
  ] },
  { group: 'Inbound channels (recruiters come to you)', items: [
    { name: 'Belong.co', what: 'Tata-backed outbound hiring, Bengaluru focus', url: 'https://belong.co/' },
    { name: 'Cord', what: 'DM hiring teams; shows response speed', url: 'https://cord.com/' },
    { name: 'Hired / Wellfound profile', what: 'Companies apply to you', url: 'https://wellfound.com' },
    { name: 'LinkedIn "Open to Work" — recruiters only', what: 'Private signal; public banner lowers response', url: 'https://www.linkedin.com/jobs/' },
  ] },
  { group: 'Bengaluru events (warm intros beat cold DMs ~10x)', items: [
    { name: 'HasGeek / The Fifth Elephant', what: 'Year-round meetups with founders', url: 'https://hasgeek.com' },
    { name: 'GDG Bangalore', what: '"Build with AI" sessions', url: 'https://gdg.community.dev' },
    { name: 'SaaSBoomi / AIBoomi events', what: 'Meet founders who hire before JDs exist', url: 'https://saasboomi.org/' },
    { name: 'Meetup: Bangalore MLOps / Deep Tech Stars / PyData', what: 'Job-seeker registration, job fairs', url: 'https://www.meetup.com/find/?keywords=AI&location=in--Bangalore' },
  ] },
];
