import { track } from './obs';
import { createHash } from 'node:crypto';
import { allProfiles, chatJson, listOf } from './llm';
import { getJSON, hgetall, hset, setJSON, delKey } from './store';
import { getProfile } from './profile';
import { getCv } from './cv';
import { secret } from './secrets';
import type { Job, RawJob } from './types';

/**
 * Semantic relevance engine (kills keyword noise):
 *   Stage 1  hard rules (free, deterministic) — non-target titles, agencies / consultancies, spam posters
 *   Stage 2  bi-encoder: embed every job + your profile (roles + tech stack + CV) → cosine similarity
 *   Stage 3  cross-encoder style rerank of the top 50 against your exact tech preferences
 *            (Cohere Rerank when COHERE_API_KEY is set, otherwise the LLM reads all 50 side by side)
 *   + ghost jobs: the same company+title seen open / reposted for 60+ days is flagged and pushed down.
 * Scores are personal (each user's own profile) and cached per job; only new jobs or a changed profile cost calls.
 */

// ---------- Stage 1 ----------
const NOISE_TITLE = /\b(intern(ship)?s?|trainee|apprentice|fresher|(inside |field )?sales (executive|manager|representative|associate|lead|head|director|officer)|head of sales|sales development|account (executive|manager)|business development|bdr|sdr|(data|business|financial|research|marketing|operations|qa|test) analyst|wordpress|react native|flutter|scrum master|devops manager|recruiter|talent acquisition|marketing|content writer|copywriter|customer support|support executive|teacher|tutor|trainer|annotator|data entry|telecaller|graphic designer)\b/i;
const AGENCY = /\b(staffing|recruit(ment|ing|ers)|placements?|manpower|outsourcing|talent solutions|hr (services|solutions)|hiring partner|job ?portal|search partners|headhunt(ers|ing)?|rpo|(placement|recruitment|manpower|hr|staffing|job) consultan(cy|ts))\b/i;
const JUNIOR_ONLY = /\b(junior|jr\.?)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|lead|principal|mid|founding)\b/i;
const SPAM = /(urgent(ly)? hiring.*(whatsapp|call)|registration fee|pay .* to apply|work from home .* earn|₹\s?\d+.*per day|part[- ]time typing)/i;
export function hardNoise(j: Pick<RawJob, 'title' | 'company' | 'description'>): string | null {
  const t = j.title.slice(0, 140); // some community posts glue the whole post into the title
  if (NOISE_TITLE.test(t)) return `title: ${t.match(NOISE_TITLE)![0]}`;
  if (JUNIOR_ONLY.test(t) && !SENIOR.test(t)) return 'title: junior';
  if (AGENCY.test(j.company || '')) return `agency: ${j.company}`;
  if (SPAM.test(`${j.title} ${j.description || ''}`)) return 'spam pattern';
  return null;
}

// ---------- ghost jobs (shared) ----------
const normTitle = (t: string) => t.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const GHOST_DAYS = 60;
/** Remembers when each company+title was first seen open (across reposts / new ids). Returns ghost ids. */
export async function trackGhosts(jobs: Job[]): Promise<Set<string>> {
  const seen = await hgetall<{ f: string; l: string }>('ghost');
  const now = new Date().toISOString();
  const ghosts = new Set<string>();
  const writes: [string, { f: string; l: string }][] = [];
  for (const j of jobs) {
    const k = `${(j.company || '').toLowerCase().slice(0, 40)}|${normTitle(j.title).slice(0, 80)}`;
    const cur = seen[k];
    const first = cur && Date.now() - Date.parse(cur.l) < 30 * 864e5 ? cur.f : (j.postedAt && Date.parse(j.postedAt) < Date.parse(j.firstSeen) ? j.postedAt : j.firstSeen);
    if (Date.now() - Date.parse(first) > GHOST_DAYS * 864e5) ghosts.add(j.id);
    if (!cur || cur.f !== first || Date.now() - Date.parse(cur.l) > 864e5) writes.push([k, { f: first, l: now }]);
  }
  for (let i = 0; i < writes.length; i += 50) await Promise.all(writes.slice(i, i + 50).map(([k, v]) => hset('ghost', k, v)));
  return ghosts;
}

// ---------- Stage 2: embeddings ----------
async function geminiKey(): Promise<string> {
  if (secret('GEMINI_API_KEY')) return secret('GEMINI_API_KEY');
  return (await allProfiles()).find((p) => p.preset === 'gemini' && p.enabled && p.key)?.key || '';
}
export async function embedder(): Promise<string> {
  if (await geminiKey()) return 'Gemini gemini-embedding-001';
  if (secret('OLLAMA_BASE_URL')) return `Ollama ${secret('OLLAMA_EMBED_MODEL') || 'nomic-embed-text'}`;
  if (secret('OPENAI_API_KEY')) return 'OpenAI text-embedding-3-small';
  return '';
}
const DIM = 256;
const BATCH = 25; // Gemini free tier counts every text against a per-minute quota
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  const gk = await geminiKey();
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH).map((t) => t.slice(0, 2000) || '-');
    if (gk) {
      const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${gk}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ requests: chunk.map((text) => ({ model: 'models/gemini-embedding-001', content: { parts: [{ text }] }, taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: DIM })) }),
      });
      let r = await call();
      if (r.status === 429) { await sleep(35000); r = await call(); } // per-minute window
      if (r.status === 429) throw Object.assign(new Error('embedding quota for this minute/day used — resumes on the next run'), { quota: true });
      if (!r.ok) throw new Error(`embeddings ${r.status}: ${(await r.text()).slice(0, 200)}`);
      out.push(...((await r.json()).embeddings as { values: number[] }[]).map((e) => e.values));
    } else if (secret('OLLAMA_BASE_URL')) {
      const base = secret('OLLAMA_BASE_URL').replace(/\/v1\/?$/, '').replace(/\/$/, '');
      const r = await fetch(`${base}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: secret('OLLAMA_EMBED_MODEL') || 'nomic-embed-text', input: chunk }), signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`ollama embeddings ${r.status}`);
      out.push(...(await r.json()).embeddings);
    } else if (secret('OPENAI_API_KEY')) {
      const r = await fetch('https://api.openai.com/v1/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret('OPENAI_API_KEY')}` }, body: JSON.stringify({ model: 'text-embedding-3-small', input: chunk, dimensions: DIM }), signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`openai embeddings ${r.status}`);
      out.push(...((await r.json()).data as { embedding: number[] }[]).map((d) => d.embedding));
    } else throw new Error('No embedding provider: add a Gemini key (free) in AI & Keys, or OLLAMA_BASE_URL when running locally');
  }
  return out;
}
function cosine(a: number[], b: number[]): number {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

// ---------- the pass ----------
export interface Sem { s: number; r?: number; why?: string; h: string; at: string }
export const jobText = (j: Pick<Job, 'title' | 'company' | 'location' | 'description'>) => `${j.title} at ${j.company} (${j.location}). ${(j.description || '').slice(0, 400)}`;
async function profileText(): Promise<{ text: string; tech: string[]; h: string }> {
  const [p, cv] = await Promise.all([getProfile(), getCv()]);
  const tech = p.tech?.length ? p.tech : [];
  const text = `Target roles: ${p.roles.join(', ')}. Locations: ${p.locations.join(', ')}. Experience ${p.expMin}-${p.expMax} years. Tech I want to work with: ${tech.join(', ')}. Skills: ${cv.skills.join(', ')}. ${(cv.text || '').slice(0, 1500)}`;
  return { text, tech, h: createHash('sha1').update(text).digest('hex').slice(0, 12) };
}

export async function semanticPass(jobs: Job[], opts: { budgetMs?: number; rerankTop?: number } = {}): Promise<{ embedded: number; reranked: number; engine: string; reranker: string; ms: number; pending: number; note: string }> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 120000;
  const engine = await embedder();
  if (!engine) throw new Error('No embedding provider: add a Gemini key (free) in AI & Keys, or OLLAMA_BASE_URL when running locally');
  const prof = await profileText();
  const sem = await hgetall<Sem>('sem');
  // profile vector (cached until the profile / CV changes)
  let pv = await getJSON<{ h: string; v: number[] } | null>('semvec', null);
  if (!pv || pv.h !== prof.h) { pv = { h: prof.h, v: (await embed([prof.text]))[0] }; await setJSON('semvec', pv); }
  const todo = jobs.filter((j) => sem[j.id]?.h !== prof.h);
  let embedded = 0;
  let note = '';
  for (let i = 0; i < todo.length && Date.now() - t0 < budget * 0.6; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    let vecs: number[][];
    try { vecs = await embed(chunk.map(jobText)); } catch (e) { if ((e as { quota?: boolean }).quota) { note = (e as Error).message; break; } throw e; }
    const at = new Date().toISOString();
    await Promise.all(chunk.map((j, k) => { const v: Sem = { s: Math.round(cosine(pv!.v, vecs[k]) * 1000) / 1000, h: prof.h, at }; sem[j.id] = v; return hset('sem', j.id, v); }));
    embedded += chunk.length;
  }
  // Stage 3: rerank the top N by semantic score (only ones not reranked for this profile yet)
  const topN = opts.rerankTop ?? 50;
  const ranked = jobs.filter((j) => sem[j.id]?.h === prof.h).sort((a, b) => sem[b.id].s - sem[a.id].s).slice(0, topN);
  const need = ranked.filter((j) => sem[j.id].r === undefined);
  let reranked = 0;
  const reranker = secret('COHERE_API_KEY') ? 'Cohere rerank-v3.5' : 'LLM side-by-side';
  const query = `Best job for: ${prof.text.slice(0, 900)}. Must-have tech focus: ${prof.tech.join(', ') || 'AI / LLM deployment'}.`;
  if (need.length && Date.now() - t0 < budget * 0.8) {
    if (secret('COHERE_API_KEY')) {
      const r = await fetch('https://api.cohere.com/v2/rerank', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret('COHERE_API_KEY')}` }, body: JSON.stringify({ model: 'rerank-v3.5', query, documents: need.map(jobText), top_n: need.length }), signal: AbortSignal.timeout(30000) });
      if (r.ok) for (const x of (await r.json()).results as { index: number; relevance_score: number }[]) { const j = need[x.index]; sem[j.id] = { ...sem[j.id], r: Math.round(x.relevance_score * 100) / 100 }; await hset('sem', j.id, sem[j.id]); reranked++; }
    } else {
      for (let i = 0; i < need.length && Date.now() - t0 < budget * 0.9; i += 25) {
        const chunk = need.slice(i, i + 25);
        const { data } = await chatJson<{ items: { i: number; score: number; why: string }[] }>(
          'You are a strict technical recruiter for elite AI engineers. Score how well each job fits the candidate — the actual work (deployment, serving, infra, applied LLM work with customers), the tech stack and seniority. Generic analyst / front-end / "uses ChatGPT" jobs score low. Be harsh: 0.85+ only for genuinely excellent fits.',
          `CANDIDATE: ${query}\n\nJOBS:\n${chunk.map((j, k) => `[${k}] ${jobText(j)}`).join('\n')}\n\nJSON: {"items":[{"i":0,"score":0.0,"why":"max 15 words: the concrete reason"}]} — one item per job, score 0..1`,
          { maxTokens: 2500, timeoutMs: 60000 },
        ).catch(() => ({ data: null }));
        for (const x of listOf<{ i: number; score: number; why: string }>(data, 'items')) {
          const j = chunk[Number(x.i)];
          if (!j) continue;
          sem[j.id] = { ...sem[j.id], r: Math.max(0, Math.min(1, Number(x.score) || 0)), why: String(x.why || '').slice(0, 140) };
          await hset('sem', j.id, sem[j.id]);
          reranked++;
        }
      }
    }
  }
  // drop scores for jobs that are gone (keeps the hash small)
  const live = new Set(jobs.map((j) => j.id));
  if (Object.keys(sem).length > live.size * 2 + 200) { await delKey('sem'); await Promise.all(Object.entries(sem).filter(([id]) => live.has(id)).map(([id, v]) => hset('sem', id, v))); }
  await setJSON('sem:meta', { at: new Date().toISOString(), engine, reranker, embedded, reranked, pending: todo.length - embedded });
  await track('semantic', 'rank jobs', note ? 'warn' : 'ok', `${embedded} embedded · ${reranked} reranked · ${todo.length - embedded} pending${note ? ` · ${note}` : ''}`, Date.now() - t0);
  return { embedded, reranked, engine, reranker, ms: Date.now() - t0, pending: todo.length - embedded, note };
}
export const getSem = () => hgetall<Sem>('sem');
