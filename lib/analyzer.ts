import { randomBytes } from 'node:crypto';
import { aiConfigured, chatJson } from './llm';
import { readPage, webSearch, type WebResult } from './search';
import { newsSearch } from './news';
import { fetchTweet, tweetIdFromUrl } from './xposts';
import { getCv } from './cv';
import { decodeEntities, getJson, pool, stripHtml } from './http';
import { hgetall, hset, hdel } from './store';
import { loadVault } from './secrets';

/**
 * Job analyzer & interview prep. Paste a job post (LinkedIn, X, any careers portal — link and/or text) →
 *  1. the post is read in full (X via its public embed, other links via the reader)
 *  2. research: real interview reports (Glassdoor, AmbitionBox, LeetCode Discuss, Reddit, Blind, GfG, Medium),
 *     company news (last 60 days), reviews / culture, engineering blog — full pages read, every claim linked
 *  3. four AI passes over the evidence: role decode · company good & bad + strategy + referrals ·
 *     round-by-round questions (source-backed ones marked) · CV fit, gaps, projects, skills, 7-day plan
 * Honest: questions marked "reported" come from real interview write-ups; "likely" ones are predicted from the JD.
 */
export interface Src { n: number; title: string; url: string; kind: string }
export interface Analysis {
  id: string; at: string; input: { url?: string; text?: string; company?: string }; ai: string; ms: number;
  job: { title: string; company: string; location: string; seniority: string; type: string; summary: string; mustHave: string[]; niceToHave: string[]; stack: string[]; responsibilities: string[]; redFlags: string[]; salary: string };
  company: { about: string; good: string[]; bad: string[]; news: { headline: string; date: string; url: string }[]; culture: string; stability: string; payInsight: string; verdict: string };
  process: { rounds: { name: string; format: string; focus: string; duration: string; tips: string[] }[]; timeline: string; difficulty: string; source: string };
  questions: { round: string; items: { q: string; type: string; why: string; answer: string; source: 'reported' | 'likely'; ref?: number }[] }[];
  askThem: string[];
  strategy: { mindset: string[]; positioning: string; storyBank: string[]; doNot: string[] };
  referrals: { targets: { who: string; why: string; search: string }[]; messages: { kind: string; text: string }[]; hacks: string[] };
  fit: { score: number; strengths: string[]; gaps: string[]; resumeTweaks: string[]; projects: { name: string; what: string; stack: string; why: string; days: string }[]; skills: { skill: string; why: string; resource: string }[]; plan: { day: string; tasks: string }[] };
  sources: Src[];
}

const strip = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\n{3,}/g, '\n\n');

/** Job boards with public APIs: exact job text, no scraping (Greenhouse, Lever, Ashby). */
async function fromAts(url: string): Promise<string | null> {
  const u = new URL(url);
  const seg = u.pathname.split('/').filter(Boolean);
  const html2txt = (h: string) => stripHtml(decodeEntities(h), 14000);
  if (/greenhouse\.io$/.test(u.hostname)) {
    const id = u.searchParams.get('gh_jid') || seg[seg.indexOf('jobs') + 1];
    const slug = seg[0] === 'embed' ? u.searchParams.get('for') : seg[0];
    if (!id || !slug) return null;
    const j = await getJson<any>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`);
    return `${j.title}\nLocation: ${j.location?.name || ''}\n${html2txt(j.content || '')}`;
  }
  if (u.hostname === 'jobs.lever.co' && seg[1]) {
    const j = await getJson<any>(`https://api.lever.co/v0/postings/${seg[0]}/${seg[1]}`);
    return `${j.text}\nLocation: ${j.categories?.location || ''}\n${j.descriptionPlain || ''}\n${(j.lists || []).map((l: any) => `${l.text}:\n${html2txt(l.content || '')}`).join('\n')}\n${j.additionalPlain || ''}`;
  }
  if (u.hostname === 'jobs.ashbyhq.com' && seg[1]) {
    const d = await getJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${seg[0]}?includeCompensation=true`);
    const j = (d.jobs || []).find((x: any) => x.id === seg[1] || String(x.jobUrl || '').includes(seg[1]));
    if (!j) throw new Error('This job is no longer open on its board (closed or the link is broken). Paste the description text instead.');
    return `${j.title}\nLocation: ${j.location || ''} ${j.isRemote ? '(remote)' : ''}\n${j.compensation?.compensationTierSummary || ''}\n${j.descriptionPlain || html2txt(j.descriptionHtml || '')}`;
  }
  return null;
}

async function readJobPost(url?: string, text?: string): Promise<string> {
  let body = (text || '').trim();
  if (url) {
    const tid = tweetIdFromUrl(url);
    const ats = tid ? null : await fromAts(url).catch((e: Error) => { if (/no longer open/.test(e.message) && !body) throw e; return null; });
    if (ats) return `${ats}\n\n${body}`.slice(0, 14000);
    try {
      if (tid) {
        const t = await fetchTweet(tid);
        if (t) body = `${t.author} (@${t.handle}) on X, ${t.createdAt || ''}:\n${t.text}\n${t.links.join(' ')}\n\n${body}`;
      } else {
        const page = strip(await readPage(url, 16000));
        if (/page not found|job (is )?no longer|position has been filled|this job has expired|404/i.test(page.slice(0, 1500)) && page.length < 2500) {
          if (!body) throw new Error('This job page says it is closed / not found. Paste the description text instead.');
        } else if (page.length > 300) body = `${page}\n\n${body}`;
      }
    } catch (e) { if (/closed|no longer/.test((e as Error).message)) throw e; }
  }
  return body.slice(0, 14000);
}

export async function analyzeJob(input: { url?: string; text?: string; company?: string; role?: string }): Promise<Analysis> {
  const t0 = Date.now();
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const post = await readJobPost(input.url, input.text);
  if (post.length < 120 && !input.company) throw new Error('Could not read that link (LinkedIn often blocks readers). Paste the job description text as well.');
  const cv = await getCv();

  // ---- pass 1: decode the job ----
  const { data: job, meta: m1 } = await chatJson<Analysis['job']>(
    'You decode job posts precisely. Use only the post. Unknown → "not stated".',
    `JOB POST:\n${post}\n${input.company ? `Company (given): ${input.company}\n` : ''}${input.role ? `Role (given): ${input.role}\n` : ''}
JSON: {"title":"","company":"","location":"","seniority":"junior|mid|senior|staff|lead","type":"full-time|contract|internship|…","summary":"3 sentences: what this person will really do day to day","mustHave":[""],"niceToHave":[""],"stack":[""],"responsibilities":[""],"redFlags":["anything vague, unrealistic or worrying — or empty"],"salary":"as stated or not stated"}`,
    { maxTokens: 2000, timeoutMs: 60000 },
  );
  if (!job?.company && !input.company) throw new Error('Could not identify the company — add the company name');
  const company = (input.company || job!.company).trim();
  const role = (input.role || job!.title || 'engineer').trim();
  const roleShort = role.replace(/\(.*?\)|senior|staff|lead|principal|sr\.?|jr\.?|ii+|\bi\b/gi, '').replace(/\s+/g, ' ').trim() || role;

  // ---- research (all in parallel, real pages read) ----
  const Q: [string, string][] = [
    ['interview', `${company} ${roleShort} interview questions`],
    ['interview', `${company} interview experience ${roleShort} glassdoor OR ambitionbox`],
    ['interview', `site:leetcode.com/discuss ${company} interview`],
    ['interview', `${company} interview process rounds reddit OR blind`],
    ['interview', `${roleShort} interview questions ${/forward|deploy/i.test(role) ? 'forward deployed engineer case study' : 'system design'}`],
    ['reviews', `${company} employee reviews culture work life balance`],
    ['company', `${company} engineering blog AI`],
  ];
  const res = await pool(Q, 4, ([, q]) => webSearch(q, 8, 'any'));
  const hits: (WebResult & { kind: string })[] = [];
  const seen = new Set<string>();
  res.forEach((r, i) => { if (r.status === 'fulfilled') for (const x of r.value.results) { const k = x.url.split('#')[0]; if (!seen.has(k)) { seen.add(k); hits.push({ ...x, kind: Q[i][0] }); } } });
  const news = await newsSearch([`${company}`, `${company} layoffs OR funding OR hiring`], 60, { perQuery: 8 }).catch(() => ({ items: [] }));
  // read the best interview / review pages in full
  const toRead = [...hits.filter((h) => h.kind === 'interview').slice(0, 7), ...hits.filter((h) => h.kind === 'reviews').slice(0, 2)];
  const pages = await pool(toRead, 4, async (h) => ({ h, txt: strip(await readPage(h.url, 9000)).slice(0, 3500) }));
  const sources: Src[] = [];
  const addSrc = (title: string, url: string, kind: string) => { const n = sources.length + 1; sources.push({ n, title: title.slice(0, 140), url, kind }); return n; };
  const evidence: string[] = [];
  for (const p of pages) if (p.status === 'fulfilled' && p.value.txt.length > 300) evidence.push(`[S${addSrc(p.value.h.title, p.value.h.url, p.value.h.kind)}] ${p.value.h.title}\n${p.value.txt}`);
  for (const h of hits.filter((x) => !toRead.includes(x)).slice(0, 14)) evidence.push(`[S${addSrc(h.title, h.url, h.kind)}] ${h.title}: ${h.snippet.slice(0, 300)}`);
  const newsLines = news.items.slice(0, 12).map((n) => `[S${addSrc(n.title, n.url, 'news')}] ${(n.date || '').slice(0, 10)} ${n.source}: ${n.title}`);
  const EV = evidence.join('\n\n').slice(0, 30000);
  const JOB = `ROLE: ${role} at ${company} (${job?.location || 'location not stated'}, ${job?.seniority || ''})\nSUMMARY: ${job?.summary || ''}\nMUST: ${(job?.mustHave || []).join('; ')}\nNICE: ${(job?.niceToHave || []).join('; ')}\nSTACK: ${(job?.stack || []).join(', ')}`;
  const CV = cv.text ? `CANDIDATE CV (real — never invent facts beyond it):\n${cv.text.slice(0, 6000)}` : `CANDIDATE: CV not uploaded. Known: Bengaluru-based, moving into AI engineering (FDE / AI-ML). Skills: ${cv.skills.join(', ') || 'unknown'}.`;

  // ---- passes 2-4 in parallel ----
  const [p2, p3, p4] = await Promise.allSettled([
    chatJson<{ company: Analysis['company']; process: Analysis['process']; strategy: Analysis['strategy']; referrals: Analysis['referrals'] }>(
      'You are an elite career strategist and recruiter insider. Use the evidence; cite with [S#] inside text where a fact comes from a source. Never invent facts about the company — if unknown, say so. Be specific and practical.',
      `${JOB}\n\nCOMPANY NEWS (last 60 days):\n${newsLines.join('\n') || 'none found'}\n\nEVIDENCE (interview reports, reviews, blog):\n${EV.slice(0, 22000)}
JSON: {"company":{"about":"","good":["specific positives with [S#]"],"bad":["specific negatives/risks with [S#]"],"news":[{"headline":"","date":"","url":""}],"culture":"","stability":"funding/layoffs/growth read","payInsight":"ranges if found (with source) else not found","verdict":"should a candidate go for it and why, 2 sentences"},
"process":{"rounds":[{"name":"","format":"","focus":"","duration":"","tips":[""]}],"timeline":"","difficulty":"","source":"which sources describe the process, or 'predicted from similar roles'"},
"strategy":{"mindset":["how to think walking into each stage"],"positioning":"the 1-line story this candidate should tell","storyBank":["STAR stories to prepare, mapped to the JD"],"doNot":["mistakes that kill offers here"]},
"referrals":{"targets":[{"who":"exact titles/teams to approach","why":"","search":"a LinkedIn/Google search string to find them"}],"messages":[{"kind":"LinkedIn connection note (<300 chars)","text":""},{"kind":"Referral ask after they accept","text":""},{"kind":"Recruiter cold email","text":""},{"kind":"Follow-up after 5 days","text":""}],"hacks":["genuine, ethical tactics to get a referral / interview faster"]}}`,
      { maxTokens: 6000, timeoutMs: 150000 },
    ),
    chatJson<{ questions: Analysis['questions']; askThem: string[] }>(
      'You are a senior interviewer who has run this exact loop. Produce the questions this candidate will most likely face, round by round. Mark source:"reported" ONLY when the question (or a very close variant) appears in the evidence, and give its [S#] number in ref; everything else is source:"likely" (predicted from the JD and company). For each question give a crisp model-answer outline (what a strong answer covers). Depth over fluff.',
      `${JOB}\n\nEVIDENCE:\n${EV.slice(0, 24000)}
JSON: {"questions":[{"round":"e.g. Recruiter screen | Technical / coding | System / ML design | FDE case study / customer scenario | Behavioural / hiring manager | Bar raiser / culture","items":[{"q":"","type":"technical|design|coding|case|behavioural|culture","why":"what they test","answer":"model answer outline, 2-4 lines","source":"reported|likely","ref":0}]}],"askThem":["sharp questions the candidate should ask"]}
Cover every round. 8-15 questions per round.`,
      { maxTokens: 8000, timeoutMs: 170000 },
    ),
    chatJson<Analysis['fit']>(
      'You are an honest hiring manager. Compare the CV to the job. Never invent experience the CV does not show. Suggest projects that are buildable fast and directly prove the must-haves.',
      `${JOB}\n\n${CV}
JSON: {"score":0-100,"strengths":["with evidence from the CV"],"gaps":["must-haves the CV does not show"],"resumeTweaks":["concrete edits / bullet rewrites using only real experience"],"projects":[{"name":"","what":"","stack":"","why":"which must-have it proves","days":"build time"}],"skills":[{"skill":"","why":"","resource":"free resource"}],"plan":[{"day":"Day 1","tasks":""}]}
3-4 projects, 5-8 skills, a 7-day plan.`,
      { maxTokens: 4000, timeoutMs: 120000 },
    ),
  ]);
  const ok = <T,>(r: PromiseSettledResult<{ data: T | null }>) => (r.status === 'fulfilled' ? r.value.data : null);
  const a2 = ok(p2), a3 = ok(p3), a4 = ok(p4);
  if (!a2 && !a3 && !a4) throw new Error('The AI provider failed (quota?) — try again in a minute');
  const analysis: Analysis = {
    id: randomBytes(5).toString('hex'), at: new Date().toISOString(), input: { url: input.url, text: input.text?.slice(0, 2000), company: input.company }, ai: m1.provider + ' · ' + m1.model, ms: Date.now() - t0,
    job: { title: role, company, location: job?.location || 'not stated', seniority: job?.seniority || '', type: job?.type || '', summary: job?.summary || '', mustHave: job?.mustHave || [], niceToHave: job?.niceToHave || [], stack: job?.stack || [], responsibilities: job?.responsibilities || [], redFlags: (job?.redFlags || []).filter((x) => x && !/^not stated|^none/i.test(x)), salary: job?.salary || 'not stated' },
    company: { about: '', good: [], bad: [], news: [], culture: '', stability: '', payInsight: '', verdict: '', ...(a2?.company || {}) },
    process: { rounds: [], timeline: '', difficulty: '', source: '', ...(a2?.process || {}) },
    questions: (a3?.questions || []).filter((r) => r?.items?.length),
    askThem: a3?.askThem || [],
    strategy: { mindset: [], positioning: '', storyBank: [], doNot: [], ...(a2?.strategy || {}) },
    referrals: { targets: [], messages: [], hacks: [], ...(a2?.referrals || {}) },
    fit: { score: 0, strengths: [], gaps: [], resumeTweaks: [], projects: [], skills: [], plan: [], ...(a4 || {}), ...(cv.text || cv.skills.length ? {} : { score: -1 }) },
    sources,
  };
  if (!analysis.company.news.length) analysis.company.news = news.items.slice(0, 8).map((n) => ({ headline: n.title, date: (n.date || '').slice(0, 10), url: n.url }));
  await hset('analyses', analysis.id, analysis);
  return analysis;
}

export async function listAnalyses() {
  return Object.values(await hgetall<Analysis>('analyses')).sort((a, b) => b.at.localeCompare(a.at)).map((a) => ({ id: a.id, at: a.at, title: a.job.title, company: a.job.company, score: a.fit.score }));
}
export async function getAnalysis(id: string) { return (await hgetall<Analysis>('analyses'))[id] || null; }
export async function deleteAnalysis(id: string) { await hdel('analyses', id); }
