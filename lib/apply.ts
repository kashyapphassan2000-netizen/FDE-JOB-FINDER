import { createHash } from 'node:crypto';
import { atsFromUrl } from './atsdetect';
import { chatJson, listOf } from './llm';
import { getCv } from './cv';
import { getJSON, hdel, hgetall, hset, setJSON } from './store';
import { readPage } from './search';
import { track } from './obs';

/**
 * AUTO-APPLY
 *  1. Apply profile: your standard answers (name, phone, links, notice period, CTC, visa…) — filled from your CV by AI, edited by you.
 *  2. Apply kit per job: the job's REAL application questions (Greenhouse + Ashby public APIs; other sites: read from the page),
 *     answered by AI strictly from your CV + profile (unknowns are flagged for you, never invented) + a tailored cover note.
 *  3. Fill: the autofill bookmarklet (one click on the application page) or the local runner (`npm run apply`), which
 *     opens each queued application, fills every field, attaches your CV and — only with --submit — submits it.
 * LinkedIn Easy Apply is deliberately not automated (against LinkedIn's terms; accounts get banned).
 */
export interface ApplyProfile {
  firstName: string; lastName: string; fullName: string; email: string; phone: string; location: string; linkedin: string; github: string; website: string;
  currentCompany: string; currentTitle: string; years: string; noticePeriod: string; currentCtc: string; expectedCtc: string;
  workAuth: string; relocate: string; heardFrom: string; pronouns: string; pitch: string;
}
export const EMPTY_PROFILE: ApplyProfile = { firstName: '', lastName: '', fullName: '', email: '', phone: '', location: 'Bengaluru, India', linkedin: '', github: '', website: '', currentCompany: '', currentTitle: '', years: '', noticePeriod: '', currentCtc: '', expectedCtc: '', workAuth: 'Authorized to work in India; no sponsorship needed for India roles', relocate: 'Yes', heardFrom: 'Company careers page', pronouns: '', pitch: '' };
export interface KitField { label: string; required: boolean; type: string; options: string[]; answer: string; needsYou: boolean; review?: boolean }
export interface Kit { id: string; url: string; applyUrl: string; title: string; company: string; ats: string; fields: KitField[]; coverLetter: string; status: 'ready' | 'queued' | 'applied' | 'skipped' | 'failed'; note?: string; createdAt: string; updatedAt: string }

export async function getApplyProfile(): Promise<ApplyProfile> { return { ...EMPTY_PROFILE, ...(await getJSON<Partial<ApplyProfile>>('apply:profile', {})) }; }
export async function saveApplyProfile(p: Partial<ApplyProfile>): Promise<ApplyProfile> {
  const cur = await getApplyProfile();
  const next = { ...cur } as ApplyProfile;
  for (const k of Object.keys(EMPTY_PROFILE) as (keyof ApplyProfile)[]) if (p[k] !== undefined) next[k] = String(p[k]).slice(0, k === 'pitch' ? 2000 : 300);
  if (!next.fullName && (next.firstName || next.lastName)) next.fullName = `${next.firstName} ${next.lastName}`.trim();
  await setJSON('apply:profile', next);
  return next;
}
export async function profileFromCv(): Promise<ApplyProfile> {
  const cv = await getCv();
  if (!cv.text) throw new Error('Upload your CV in the CV tab first');
  const { data } = await chatJson<Partial<ApplyProfile>>('Extract job-application profile fields from a CV. Only what the CV states — leave unknown fields as "". pitch = 3 sentences in first person, concrete, from the CV only.', `CV:\n${cv.text.slice(0, 12000)}\nJSON keys: ${Object.keys(EMPTY_PROFILE).join(', ')}`, { maxTokens: 1500, timeoutMs: 60000 });
  const cur = await getApplyProfile();
  const merged: Partial<ApplyProfile> = {};
  for (const k of Object.keys(EMPTY_PROFILE) as (keyof ApplyProfile)[]) merged[k] = cur[k] && cur[k] !== EMPTY_PROFILE[k] ? cur[k] : String(data?.[k] ?? '') || cur[k];
  return saveApplyProfile(merged);
}

// ---------- the job's real questions ----------
async function greenhouseQuestions(url: string, slug: string): Promise<KitField[] | null> {
  const id = url.match(/jobs\/(\d+)/)?.[1] || new URL(url).searchParams.get('gh_jid');
  if (!id) return null;
  const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?questions=true`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const d = await r.json();
  return [...(d.questions || []), ...(d.location_questions || [])].map((q: { label: string; required: boolean; fields: { type: string; values?: { label: string }[] }[] }) => ({ label: q.label, required: Boolean(q.required), type: q.fields?.[0]?.type || 'input_text', options: (q.fields?.[0]?.values || []).map((v) => v.label), answer: '', needsYou: false }));
}
async function ashbyQuestions(url: string, slug: string): Promise<KitField[] | null> {
  const id = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  if (!id) return null;
  const r = await fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ operationName: 'ApiJobPosting', variables: { organizationHostedJobsPageName: slug, jobPostingId: id }, query: 'query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { title applicationForm { sections { fieldEntries { field isRequired } } } } }' }) });
  if (!r.ok) return null;
  const d = await r.json();
  const secs = d?.data?.jobPosting?.applicationForm?.sections || [];
  return secs.flatMap((s: { fieldEntries: { field: { title: string; type: string; selectableValues?: { label: string }[] }; isRequired: boolean }[] }) => s.fieldEntries.map((f) => ({ label: f.field.title, required: f.isRequired, type: f.field.type, options: (f.field.selectableValues || []).map((v) => v.label), answer: '', needsYou: false })));
}

export async function prepareKit(input: { url: string; title?: string; company?: string }): Promise<Kit> {
  const url = input.url.trim();
  if (!/^https?:\/\//.test(url)) throw new Error('Paste the job link');
  if (/linkedin\.com/i.test(url)) throw new Error('LinkedIn Easy Apply is not automated (it breaks LinkedIn’s terms and gets accounts banned). Open the job on the company’s own careers page / ATS and paste that link.');
  const ats = atsFromUrl(url);
  let fields: KitField[] | null = null;
  let jd = '';
  if (ats?.ats === 'greenhouse') fields = await greenhouseQuestions(url, ats.slug).catch(() => null);
  if (ats?.ats === 'ashby') fields = await ashbyQuestions(url, ats.slug).catch(() => null);
  jd = await readPage(url, 9000).catch(() => '');
  const [cv, prof] = await Promise.all([getCv(), getApplyProfile()]);
  if (!cv.text) throw new Error('Upload your CV in the CV tab first — answers come only from your CV');
  if (!fields?.length) {
    // other ATS: read the application form text and list its questions
    const applyText = ats?.ats === 'lever' ? await readPage(`${url.replace(/\/apply\/?$/, '')}/apply`, 9000).catch(() => jd) : jd;
    const { data } = await chatJson<{ fields: KitField[] }>('List the application form questions visible on this job application page (name, email, phone, links, custom questions, yes/no questions, dropdowns). If the form is not visible, list the usual questions for this kind of role.', `PAGE:\n${applyText.slice(0, 9000)}\nJSON: {"fields":[{"label":"","required":true,"type":"text|textarea|select|yesno|file","options":[]}]}`, { maxTokens: 1500, timeoutMs: 45000 }).catch(() => ({ data: null }));
    fields = listOf<KitField>(data, 'fields').map((f) => ({ label: String(f.label || ''), required: Boolean(f.required), type: String(f.type || 'text'), options: Array.isArray(f.options) ? f.options.map(String) : [], answer: '', needsYou: false })).filter((f) => f.label);
  }
  const askable = fields.filter((f) => !/resume|cv\b|cover letter file/i.test(f.label) || /text/i.test(f.type));
  const { data } = await chatJson<{ answers: { i: number; answer: string; needsYou: boolean }[]; coverLetter: string; title: string; company: string }>(
    'You fill job applications FOR the candidate, in first person. Use ONLY facts from the CV and the profile. Never invent employers, numbers, degrees or dates. If a question needs information you do not have (salary, notice period, demographics, referrer, visa details not given), answer "" and set needsYou=true. Yes/no and dropdowns: answer with one of the options exactly. Essay questions: 80-150 words, specific, using real CV achievements that match the JD — no invented scenes, quotes, people or obstacles; if the CV lacks a fitting story, say what the CV supports and keep it factual.',
    `JOB: ${input.title || ''} at ${input.company || ''} — ${url}\nJD:\n${jd.slice(0, 6000)}\n\nCANDIDATE PROFILE: ${JSON.stringify(prof)}\nCV:\n${cv.text.slice(0, 8000)}\n\nQUESTIONS:\n${askable.map((f, i) => `[${i}] ${f.label}${f.options.length ? ` (options: ${f.options.join(' | ')})` : ''} [${f.type}]`).join('\n')}\n\nAlso write a cover note (max 150 words, no clichés: why this role, 2 concrete proof points from the CV, one line on what I'd do in the first 90 days) and the exact job title + company from the JD.\nJSON: {"title":"","company":"","answers":[{"i":0,"answer":"","needsYou":false}],"coverLetter":""}`,
    { maxTokens: 3500, timeoutMs: 90000 },
  );
  for (const a of listOf<{ i: number; answer: string; needsYou: boolean }>(data, 'answers')) { const f = askable[Number(a.i)]; if (f) { f.answer = String(a.answer ?? '').slice(0, 3000); f.needsYou = Boolean(a.needsYou) || (!f.answer && f.required); f.review = Boolean(f.answer) && (f.answer.length > 160 || /longtext|textarea|essay/i.test(f.type)); } }
  const now = new Date().toISOString();
  const kit: Kit = { id: createHash('sha1').update(url.split('?')[0]).digest('hex').slice(0, 12), url, applyUrl: ats?.ats === 'lever' ? `${url.replace(/\/apply\/?$/, '')}/apply` : ats?.ats === 'ashby' && !/\/application/.test(url) ? `${url.replace(/\/$/, '')}/application` : url, title: data?.title || input.title || 'Job', company: data?.company || input.company || ats?.slug || '', ats: ats?.ats || 'other', fields, coverLetter: data?.coverLetter || '', status: 'ready', createdAt: now, updatedAt: now };
  await hset('apply:kits', kit.id, kit);
  await track('autopilot', `apply kit: ${kit.title} @ ${kit.company}`, kit.fields.some((f) => f.needsYou) ? 'warn' : 'ok', `${kit.fields.length} questions (${kit.ats}) · ${kit.fields.filter((f) => f.needsYou).length} need you`);
  return kit;
}
export const listKits = async () => Object.values(await hgetall<Kit>('apply:kits')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export async function updateKit(id: string, patch: Partial<Pick<Kit, 'status' | 'note' | 'fields' | 'coverLetter'>>) {
  const k = (await hgetall<Kit>('apply:kits'))[id];
  if (!k) throw new Error('No such application kit');
  const next = { ...k, ...patch, updatedAt: new Date().toISOString() };
  await hset('apply:kits', id, next);
  if (patch.status === 'applied' || patch.status === 'failed') await track('autopilot', `application ${patch.status}: ${k.title} @ ${k.company}`, patch.status === 'applied' ? 'ok' : 'fail', patch.note || '');
  return next;
}
export const deleteKit = (id: string) => hdel('apply:kits', id);
export async function kitForUrl(url: string): Promise<Kit | null> {
  const clean = (u: string) => u.split(/[?#]/)[0].replace(/\/(apply|application)\/?$/, '').replace(/\/$/, '');
  return (await listKits()).find((k) => clean(k.url) === clean(url) || clean(k.applyUrl) === clean(url)) || null;
}
