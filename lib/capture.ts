import type { RawJob } from './types';
import { classify, hashId, locationAllowed, locationTags, domainOf } from './classify';
import { aiConfigured, chatJson } from './llm';
import { pool, relativeToIso } from './http';
import { hgetall, hset } from './store';
import { addExternalJobs } from './refresh';
import type { Find } from './agent';

/**
 * "Capture" = the page you are looking at in YOUR logged-in browser (Naukri, LinkedIn post search, X Latest,
 * Wellfound, Hirist, iimjobs, Cutshort, hiring.cafe…) is sent here by the bookmarklet and the AI extracts every
 * job / hiring post with its real link. Free, unlimited, real-time, and no site can block it because it is your session.
 */
export interface CapturePayload { u: string; t: string; x: string; l: [string, string][] }
type Item = { kind: 'job' | 'post'; title: string; company: string; location: string; link: number; posted: string; salary: string; author: string; text: string; apply_how: string };

const JOBISH = /job|career|apply|posting|vacanc|opening|status\/\d|\/posts\/|feed\/update|activity|\/j\/|\/jobs?\/|position|role|hiring|lever\.co|greenhouse|ashbyhq|workable|naukri\.com\/job|wellfound\.com\/(jobs|l\/)|hirist|iimjobs|cutshort\.io\/job|instahyre/i;

export async function processCapture(p: CapturePayload): Promise<{ host: string; jobs: number; posts: number; added: number; items: { kind: string; title: string; company: string; location: string; url: string }[]; note?: string }> {
  const host = (() => { try { return new URL(p.u).hostname.replace(/^www\./, ''); } catch { return 'page'; } })();
  const links = (p.l || []).filter(([t, h]) => t && /^https?:/.test(h) && (JOBISH.test(h) || JOBISH.test(t))).slice(0, 600);
  const text = (p.x || '').replace(/\n{3,}/g, '\n\n').slice(0, 150000);
  if (!(await aiConfigured())) return { host, jobs: 0, posts: 0, added: 0, items: [], note: 'Add an AI provider in AI & Keys — capture needs AI to read the page.' };

  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < 8; i += 13000) chunks.push(text.slice(i, i + 13500));
  const linkList = links.map(([t, h], i) => `${i}. ${t.slice(0, 90)} -> ${h.slice(0, 160)}`).join('\n').slice(0, 30000);
  const res = await pool(chunks, 2, async (chunk, ) => {
    const { data } = await chatJson<{ items: Item[] }>(
      'You extract job postings and hiring posts from a captured web page (job board search results, LinkedIn/X post feeds, company pages). Extract EVERY item about a job opening; do not summarise or skip. Use the numbered link list to give each item its own link (the job page or the post permalink); -1 if none.',
      `Page: ${p.t} (${p.u})\n\nLINKS:\n${linkList}\n\nPAGE TEXT (part):\n${chunk}\n\nJSON: {"items":[{"kind":"job|post","title":"role","company":"","location":"","link":<link number or -1>,"posted":"e.g. 2 days ago / 3h","salary":"","author":"post author if a post","text":"for posts: the post text (max 500 chars)","apply_how":"email / DM / link if stated"}]}`,
      { maxTokens: 4000, timeoutMs: 90000 },
    );
    return data?.items || [];
  });
  const items = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const seen = new Set<string>();
  const jobs: RawJob[] = [];
  const posts: Find[] = [];
  const now = new Date().toISOString();
  for (const it of items) {
    if (!it?.title) continue;
    const url = it.link >= 0 && links[it.link] ? links[it.link][1] : `${p.u}#${encodeURIComponent(it.title.slice(0, 60))}`;
    const key = `${it.title}|${it.company}|${url}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const raw: RawJob = { title: it.title.slice(0, 200), company: (it.company || it.author || host).slice(0, 120), location: (it.location || '').slice(0, 160), url, postedAt: relativeToIso(it.posted) || null, salary: it.salary || undefined, description: (it.text || '').slice(0, 1200) };
    if (it.kind === 'post') {
      const locTags = locationTags(raw);
      posts.push({ id: hashId(url), kind: 'post', title: raw.title, company: it.company || '', location: raw.location, url, snippet: it.text || '', why: `Captured from ${host}`, role: classify(raw).length ? classify(raw) : ['AIML'], domain: domainOf(raw), locTags, mission: 'capture', engine: `capture:${host}`, foundAt: now, status: 'new', author: it.author, postedAt: raw.postedAt, applyHow: it.apply_how, confidence: 'high' });
    } else jobs.push(raw);
  }
  const added = await addExternalJobs(jobs, `capture:${host}`);
  const existing = await hgetall<Find>('agent:finds');
  for (const f of posts) if (!existing[f.id] && (!f.location || locationAllowed(f.locTags, f.location))) await hset('agent:finds', f.id, f);
  return {
    host, jobs: jobs.length, posts: posts.length, added,
    items: [...jobs.map((j) => ({ kind: 'job', title: j.title, company: j.company, location: j.location, url: j.url })), ...posts.map((f) => ({ kind: 'post', title: f.title, company: f.company || f.author || '', location: f.location, url: f.url }))].slice(0, 200),
    note: items.length ? undefined : 'No jobs found on this page — open a search results page or scroll so the posts load, then click the button again.',
  };
}
