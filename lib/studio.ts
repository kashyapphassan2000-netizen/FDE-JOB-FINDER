import { randomBytes } from 'node:crypto';
import { aiConfigured, chatJson } from './llm';
import { readPage, webSearch } from './search';
import { newsSearch } from './news';
import { getJSON, hdel, hgetall, hset, setJSON } from './store';
import { decrypt, encrypt, loadVault, secret } from './secrets';
import { pool } from './http';
import { getJobs } from './refresh';
import { careersSearch } from './careersearch';
import { excelContext, getWorld } from './mentor';
import { sendMail, esc } from './mailer';
import { sendWhatsApp } from './notify';
import { getCv } from './cv';

/**
 * AGENT STUDIO — agents you design yourself, running 24×7, each fully isolated (own instructions, rules, tools, skills,
 * model, memory and chat). An agent only touches the tools / skills / other agents you granted it.
 *
 * Agentic modes (pick per agent):
 *  autonomous   ReAct: reason → act with a tool → observe → repeat
 *  plan_execute planner writes a step plan, executor runs each step with tools, then synthesises
 *  reflexion    does the job, critiques itself, retries with the lessons
 *  tree         tree-of-thought: drafts 3 approaches, scores them, executes the best
 *  team         hierarchical: a lead splits the work, members run in parallel, a critic reviews
 *  pipeline     sequential hand-off: member 1 → member 2 → … (each builds on the previous output)
 *  debate       members argue opposite sides with evidence, a judge decides
 *  swarm        every member does the whole task independently, results are merged / voted
 *  router       a router sends the task to the single best-suited member
 *  monitor      any of the above on a schedule, reports only when something is new
 *
 * Supervisor: an independent (optionally different-model) reviewer compares WHAT WAS ASKED with WHAT WAS DONE, scores it
 * brutally, and sends the work back with exact fixes until it passes or the rounds / time budget run out. The report
 * states honestly whether the supervisor approved.
 * Every agent follows its owner's instructions directly — it does not question orders; it only stops for something
 * illegal / harmful to others or impossible, and then says why in one line.
 */
export type ToolId = 'web_search' | 'read_page' | 'news' | 'company_jobs' | 'my_jobs' | 'market' | 'excel' | 'my_cv' | 'memory' | 'http_get' | 'ask_agent';
export const TOOLS: Record<ToolId, { label: string; desc: string; args: string }> = {
  web_search: { label: 'Web search', desc: 'search the whole web (Google-style operators allowed). recency: day|week|month|any', args: '{"query":"","recency":"week"}' },
  read_page: { label: 'Read any page', desc: 'open a URL and read its full text', args: '{"url":""}' },
  news: { label: 'Latest news', desc: 'dated news from the last N days (Google + Bing News)', args: '{"query":"","days":7}' },
  company_jobs: { label: 'All company job boards', desc: 'search every company careers board the app indexes (~280 boards) for a role', args: '{"role":"forward deployed engineer"}' },
  my_jobs: { label: 'My job feed', desc: 'jobs already collected by the app (filtered by words)', args: '{"filter":"FDE Bengaluru"}' },
  market: { label: 'AI market & layoffs', desc: "today's AI-jobs market report, hot skills, layoffs, hiring radar, tech/quantum/money news", args: '{}' },
  excel: { label: 'My Excel knowledge', desc: 'search the 42-sheet AI Job Search Master Excel', args: '{"query":""}' },
  my_cv: { label: 'My CV', desc: "the owner's CV text and skills", args: '{}' },
  memory: { label: 'Agent memory', desc: 'remember a fact for future runs (also given back to you every run)', args: '{"fact":""}' },
  http_get: { label: 'Call a public API / URL', desc: 'GET any public https URL (JSON or text)', args: '{"url":""}' },
  ask_agent: { label: 'Ask another agent', desc: 'delegate a sub-task to one of the other agents you are allowed to call; it runs with ITS tools and returns its report', args: '{"agent":"agent name","task":""}' },
};
export type Mode = 'autonomous' | 'plan_execute' | 'reflexion' | 'tree' | 'team' | 'pipeline' | 'debate' | 'swarm' | 'router' | 'monitor';
export const MODES: Record<Mode, { label: string; desc: string; members: boolean }> = {
  autonomous: { label: '🧠 Autonomous (ReAct)', desc: 'Reasons, picks a tool, acts, checks the result and repeats until done.', members: false },
  plan_execute: { label: '🗺 Plan & execute', desc: 'Writes a step-by-step plan first, executes each step with tools, then synthesises.', members: false },
  reflexion: { label: '🔁 Reflexion', desc: 'Does the job, critiques its own answer, then retries with the lessons learned.', members: false },
  tree: { label: '🌳 Tree of thought', desc: 'Drafts 3 different approaches, scores them, executes the best one.', members: false },
  team: { label: '👥 Hierarchical team', desc: 'A lead splits the work, members (own roles/tools/models) work in parallel, a critic reviews.', members: true },
  pipeline: { label: '⛓ Pipeline', desc: 'Members work in order — each one builds on the previous member’s output.', members: true },
  debate: { label: '⚖ Debate', desc: 'Members argue opposite sides with evidence; a judge decides.', members: true },
  swarm: { label: '🐝 Swarm', desc: 'Every member does the whole task independently; results are merged and voted.', members: true },
  router: { label: '🔀 Router', desc: 'Sends each task to the single best-suited member.', members: true },
  monitor: { label: '📡 24×7 monitor', desc: 'Runs on a schedule and reports only when something new shows up.', members: false },
};
export type Depth = 'fast' | 'deep' | 'elite';
export const DEPTHS: Record<Depth, string> = {
  fast: 'Fast — act quickly, few checks',
  deep: 'Deep — step-by-step reasoning, verify key facts',
  elite: 'Elite — first-principles, alternatives, 2-source verification, confidence levels, self-check before answering',
};
const DEPTH_PROMPT: Record<Depth, string> = {
  fast: 'Be fast and direct.',
  deep: 'Think step by step before each move: what do I know, what is missing, which tool closes the gap best. Verify key facts.',
  elite: 'Think like the best operator in the world: reason from first principles, consider 2-3 alternative approaches and pick the one with the highest evidence value, verify every important claim with at least two independent sources, quantify, state your confidence (high/medium/low) per claim, and self-check against the instructions before answering.',
};
export type Schedule = 'manual' | 'hourly' | '2h' | '6h' | '12h' | 'daily' | 'weekly';
/** Which AI runs this agent / member: a provider from AI & Keys (+ optional exact model). strict = never fall back to another provider. */
export interface ModelRef { profileId: string; model: string; strict: boolean }
export interface Member { name: string; role: string; instructions: string; tools: ToolId[]; skills: string[]; model: ModelRef }
export interface Supervisor { enabled: boolean; maxRounds: number; passScore: number; criteria: string; model: ModelRef }
export interface AgentDef {
  id: string; owner: string; name: string; emoji: string; type: Mode;
  goal: string; rules: string; tools: ToolId[]; skills: string[]; canCall: string[]; members: Member[];
  thinking: { depth: Depth; style: string }; model: ModelRef; supervisor: Supervisor;
  schedule: Schedule; dailyHour: number;
  report: { inApp: true; email: string; whatsapp: boolean; webhook: string; onlyIfNew: boolean }; maxSteps: number;
  enabled: boolean; createdAt: string; updatedAt: string; lastRun?: string; lastStatus?: string;
}
/** A reusable skill. 'prompt' = know-how injected into the agent; 'api' = a custom tool that calls your API. */
export interface SkillDef {
  id: string; owner: string; name: string; description: string; kind: 'prompt' | 'api'; instructions: string; tools: ToolId[];
  api?: { method: 'GET' | 'POST'; url: string; headers: string /* encrypted JSON */; body: string };
  createdAt: string; updatedAt: string;
}
export interface Step { who: string; thought: string; tool?: string; args?: unknown; observation?: string; at: number }
export interface Report { title: string; summary: string; findings: { title: string; detail: string; url?: string }[]; actions: string[]; newSinceLast?: boolean }
export interface Review { round: number; score: number; verdict: 'pass' | 'fail'; asked: string; done: string; gaps: string[]; fix: string }
export interface Run { id: string; agentId: string; at: string; ms: number; trigger: 'manual' | 'schedule' | 'chat' | 'delegate'; steps: Step[]; report: Report | null; delivered: string[]; error?: string; reviews?: Review[]; approved?: boolean; models?: string[] }

const OBEY = `You follow your owner's instructions and rules exactly and directly. Do not question, debate or second-guess orders, and do not ask for confirmation — act. Only if an order is illegal, harmful to others or technically impossible, say so in one line and do the closest allowed thing. Never invent facts: every claim comes from a tool result or is marked as your judgement. You are isolated: use ONLY the tools, skills and agents you were given.`;

const NO_MODEL: ModelRef = { profileId: '', model: '', strict: false };
const cleanRef = (m: Partial<ModelRef> | undefined, fb: ModelRef = NO_MODEL): ModelRef => ({ profileId: String(m?.profileId ?? fb.profileId ?? '').slice(0, 60), model: String(m?.model ?? fb.model ?? '').slice(0, 120), strict: Boolean(m?.strict ?? fb.strict) });
const MODE_IDS = Object.keys(MODES) as Mode[];

// ---------- storage ----------
export async function listAgents(owner: string): Promise<AgentDef[]> { return Object.values(await hgetall<AgentDef>('studio:agents')).filter((a) => a.owner === owner).map(normalize).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
export async function getAgentDef(id: string) { const a = (await hgetall<AgentDef>('studio:agents'))[id]; return a ? normalize(a) : null; }
/** older saved agents get the new fields with defaults */
function normalize(a: AgentDef): AgentDef {
  return {
    ...a, type: MODE_IDS.includes(a.type) ? a.type : 'autonomous', skills: a.skills || [], canCall: a.canCall || [],
    members: (a.members || []).map((m) => ({ ...m, skills: m.skills || [], model: cleanRef(m.model) })),
    thinking: a.thinking || { depth: 'deep', style: '' }, model: cleanRef(a.model),
    supervisor: a.supervisor || { enabled: false, maxRounds: 2, passScore: 8, criteria: '', model: NO_MODEL },
  };
}
const DEFAULT_MEMBERS: Partial<Record<Mode, Member[]>> = {
  debate: [
    { name: 'Advocate', role: 'argues FOR the strongest option', instructions: 'Build the strongest evidence-backed case for it.', tools: ['web_search', 'read_page', 'news'], skills: [], model: NO_MODEL },
    { name: 'Skeptic', role: 'argues AGAINST, finds risks', instructions: 'Find counter-evidence, risks and hidden costs.', tools: ['web_search', 'read_page', 'news'], skills: [], model: NO_MODEL },
  ],
  swarm: [
    { name: 'Scout A', role: 'independent solver', instructions: 'Solve the whole task your own way.', tools: ['web_search', 'read_page'], skills: [], model: NO_MODEL },
    { name: 'Scout B', role: 'independent solver', instructions: 'Solve the whole task your own way; prefer different sources than usual.', tools: ['web_search', 'news'], skills: [], model: NO_MODEL },
    { name: 'Scout C', role: 'independent solver', instructions: 'Solve the whole task; focus on primary sources.', tools: ['web_search', 'read_page'], skills: [], model: NO_MODEL },
  ],
};
export async function saveAgent(owner: string, a: Partial<AgentDef>): Promise<AgentDef> {
  const cur = a.id ? await getAgentDef(a.id) : null;
  if (cur && cur.owner !== owner) throw new Error('Not your agent');
  const tools = (a.tools || cur?.tools || ['web_search', 'read_page', 'news']).filter((t) => t in TOOLS) as ToolId[];
  const type = (MODE_IDS.includes(a.type as Mode) ? a.type : cur?.type || 'autonomous') as Mode;
  let members = (a.members ?? cur?.members ?? []).slice(0, 8).map((m) => ({ name: String(m.name || 'Member').slice(0, 40), role: String(m.role || '').slice(0, 200), instructions: String(m.instructions || '').slice(0, 3000), tools: (m.tools || tools).filter((t) => t in TOOLS) as ToolId[], skills: (m.skills || []).map(String).slice(0, 12), model: cleanRef(m.model) }));
  if (MODES[type].members && !members.length) members = DEFAULT_MEMBERS[type] || [{ name: 'Worker', role: 'does the work', instructions: '', tools, skills: [], model: NO_MODEL }];
  const sup = a.supervisor ?? cur?.supervisor;
  const def: AgentDef = {
    id: cur?.id || randomBytes(5).toString('hex'), owner, name: String(a.name ?? cur?.name ?? 'New agent').slice(0, 60) || 'New agent', emoji: String(a.emoji ?? cur?.emoji ?? '🤖').slice(0, 4),
    type, goal: String(a.goal ?? cur?.goal ?? '').slice(0, 8000), rules: String(a.rules ?? cur?.rules ?? '').slice(0, 4000), tools,
    skills: (a.skills ?? cur?.skills ?? []).map(String).slice(0, 20), canCall: (a.canCall ?? cur?.canCall ?? []).map(String).filter((x) => x !== cur?.id).slice(0, 10), members,
    thinking: { depth: (['fast', 'deep', 'elite'].includes(a.thinking?.depth as string) ? a.thinking!.depth : cur?.thinking.depth || 'deep') as Depth, style: String(a.thinking?.style ?? cur?.thinking.style ?? '').slice(0, 3000) },
    model: cleanRef(a.model, cur?.model),
    supervisor: { enabled: Boolean(sup?.enabled), maxRounds: Math.max(1, Math.min(5, Number(sup?.maxRounds) || 2)), passScore: Math.max(5, Math.min(10, Number(sup?.passScore) || 8)), criteria: String(sup?.criteria || '').slice(0, 3000), model: cleanRef(sup?.model) },
    schedule: (['manual', 'hourly', '2h', '6h', '12h', 'daily', 'weekly'].includes(a.schedule as string) ? a.schedule : cur?.schedule || 'manual') as Schedule,
    dailyHour: Math.max(0, Math.min(23, Number(a.dailyHour ?? cur?.dailyHour ?? 8))),
    report: { inApp: true, email: String(a.report?.email ?? cur?.report.email ?? '').trim().slice(0, 120), whatsapp: Boolean(a.report?.whatsapp ?? cur?.report.whatsapp), webhook: String(a.report?.webhook ?? cur?.report.webhook ?? '').trim().slice(0, 300), onlyIfNew: Boolean(a.report?.onlyIfNew ?? cur?.report.onlyIfNew ?? type === 'monitor') },
    maxSteps: Math.max(3, Math.min(20, Number(a.maxSteps ?? cur?.maxSteps ?? 8))),
    enabled: a.enabled ?? cur?.enabled ?? true, createdAt: cur?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), lastRun: cur?.lastRun, lastStatus: cur?.lastStatus,
  };
  if (!def.goal.trim()) throw new Error('Tell the agent what to do (instructions)');
  if (def.canCall.length && !def.tools.includes('ask_agent')) def.tools.push('ask_agent');
  await hset('studio:agents', def.id, def);
  return def;
}
export async function deleteAgent(owner: string, id: string) { const a = await getAgentDef(id); if (a?.owner !== owner) throw new Error('Not your agent'); await hdel('studio:agents', id); }
export async function getRuns(id: string) { return getJSON<Run[]>(`studio:runs:${id}`, []); }

// ---------- skills ----------
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'skill';
export async function listSkills(owner: string): Promise<SkillDef[]> { return Object.values(await hgetall<SkillDef>('studio:skills')).filter((s) => s.owner === owner).sort((a, b) => a.name.localeCompare(b.name)); }
export function publicSkill(s: SkillDef) { return { ...s, api: s.api ? { ...s.api, headers: s.api.headers ? '(saved — hidden)' : '' } : undefined }; }
export async function saveSkill(owner: string, s: Partial<SkillDef> & { headersPlain?: string }): Promise<SkillDef> {
  const all = await hgetall<SkillDef>('studio:skills');
  const cur = s.id ? all[s.id] : null;
  if (cur && cur.owner !== owner) throw new Error('Not your skill');
  const kind = s.kind === 'api' ? 'api' : 'prompt';
  let api: SkillDef['api'];
  if (kind === 'api') {
    const url = String(s.api?.url ?? cur?.api?.url ?? '').trim();
    if (!/^https?:\/\//.test(url)) throw new Error('API skill needs a URL (use {input} where the agent’s input goes)');
    if (s.headersPlain) { try { JSON.parse(s.headersPlain); } catch { throw new Error('Headers must be JSON, e.g. {"Authorization":"Bearer …"}'); } }
    api = { method: s.api?.method === 'POST' ? 'POST' : 'GET', url, headers: s.headersPlain ? encrypt(s.headersPlain) : cur?.api?.headers || '', body: String(s.api?.body ?? cur?.api?.body ?? '').slice(0, 4000) };
  }
  const def: SkillDef = {
    id: cur?.id || `sk_${randomBytes(4).toString('hex')}`, owner, name: String(s.name ?? cur?.name ?? '').slice(0, 60).trim(), description: String(s.description ?? cur?.description ?? '').slice(0, 400),
    kind, instructions: String(s.instructions ?? cur?.instructions ?? '').slice(0, 12000), tools: (s.tools ?? cur?.tools ?? []).filter((t) => t in TOOLS) as ToolId[], api,
    createdAt: cur?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (!def.name) throw new Error('Give the skill a name');
  if (kind === 'prompt' && !def.instructions.trim()) throw new Error('Write what the skill teaches the agent');
  await hset('studio:skills', def.id, def);
  return def;
}
export async function deleteSkill(owner: string, id: string) { const s = (await hgetall<SkillDef>('studio:skills'))[id]; if (s?.owner !== owner) throw new Error('Not your skill'); await hdel('studio:skills', id); }
const isPrivateHost = (u: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[::1\]|[^/]*\.internal|metadata)/i.test(u);
async function callApiSkill(sk: SkillDef, input: string): Promise<string> {
  const a = sk.api!;
  const url = a.url.replace(/\{input\}/g, encodeURIComponent(input));
  // On the cloud deployment only public https APIs; on your own localhost install, local APIs (http://localhost…) are allowed.
  if (process.env.VERCEL && (!/^https:\/\//.test(url) || isPrivateHost(url))) return 'On the cloud app only public https APIs are allowed (run the app on localhost for local APIs)';
  let headers: Record<string, string> = {};
  if (a.headers) { try { headers = JSON.parse(decrypt(a.headers) || '{}'); } catch {} }
  const r = await fetch(url, { method: a.method, headers: { 'User-Agent': 'FDE-Job-Finder-Agent', ...(a.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: a.method === 'POST' ? (a.body || '{"input":"{input}"}').replace(/\{input\}/g, input.replace(/["\\]/g, '\\$&')) : undefined, signal: AbortSignal.timeout(20000) });
  return `${r.status}\n${trim(await r.text(), 6000)}`;
}

// ---------- tools ----------
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** Everything one run needs; isolation = an agent only sees its own tools, skills, memory and allowed agents. */
interface Ctx { a: AgentDef; skills: SkillDef[]; deadline: number; steps: Step[]; depth: number; models: Set<string>; seen: string[] }
async function runTool(ctx: Ctx, tool: string, args: Record<string, unknown>): Promise<string> {
  const agentId = ctx.a.id;
  if (tool.startsWith('skill_')) {
    const sk = ctx.skills.find((x) => x.kind === 'api' && `skill_${slug(x.name)}` === tool);
    return sk ? callApiSkill(sk, String(args.input ?? '')) : 'unknown skill';
  }
  switch (tool as ToolId) {
    case 'web_search': {
      const r = await webSearch(String(args.query || ''), 8, (['day', 'week', 'month', 'any'].includes(String(args.recency)) ? args.recency : 'month') as 'week');
      return r.results.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${(x.date || '').slice(0, 10)} ${x.snippet.slice(0, 300)}`).join('\n\n') || `no results ${r.errors.join(' ')}`;
    }
    case 'read_page': { const u = String(args.url || ''); if (!/^https?:\/\//.test(u)) return 'url must start with http'; return trim(await readPage(u, 7000), 7000); }
    case 'news': { const r = await newsSearch([String(args.query || '')], Math.max(1, Math.min(60, Number(args.days) || 7)), { perQuery: 10 }); return r.items.slice(0, 12).map((n) => `${(n.date || '').slice(0, 10)} ${n.title} (${n.source}) ${n.url}`).join('\n') || 'no news'; }
    case 'company_jobs': { const r = await careersSearch({ q: String(args.role || 'forward deployed engineer'), limit: 25 }); return `${r.total} matches across ${r.companies} companies (your locations):\n` + r.hits.slice(0, 20).map((h) => `${h.title} — ${h.company} — ${h.location || 'n/a'} — ${(h.postedAt || '').slice(0, 10)} ${h.url}`).join('\n'); }
    case 'my_jobs': {
      const ws = String(args.filter || '').toLowerCase().split(/\s+/).filter(Boolean);
      const jobs = (await getJobs()).filter((j) => ws.every((w) => `${j.title} ${j.company} ${j.location} ${j.categories.join(' ')}`.toLowerCase().includes(w))).sort((a, b) => Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
      return `${jobs.length} jobs\n` + jobs.slice(0, 20).map((j) => `${j.title} — ${j.company} — ${j.location} — ${(j.postedAt || j.firstSeen).slice(0, 10)} ${j.url}`).join('\n');
    }
    case 'market': { const w = await getWorld(); return `MARKET: ${w.marketSummary}\nHOT SKILLS: ${w.hotSkills.join('; ')}\nLAYOFFS: ${w.layoffs.join('; ')}\nHIRING: ${w.hiring.join('; ')}\nTECH: ${w.tech.join('; ')}\nQUANTUM: ${w.quantum.join('; ')}\nMONEY: ${w.money.join('; ')}`; }
    case 'excel': return excelContext(String(args.query || ''), 20) || 'nothing matched';
    case 'my_cv': { const cv = await getCv(); return cv.text ? trim(cv.text, 6000) : `No CV uploaded. Skills: ${cv.skills.join(', ') || 'unknown'}`; }
    case 'memory': { const m = await getJSON<string[]>(`studio:mem:${agentId}`, []); const f = String(args.fact || '').slice(0, 400); if (f) await setJSON(`studio:mem:${agentId}`, [f, ...m].slice(0, 80)); return 'saved'; }
    case 'http_get': {
      const u = String(args.url || '');
      if (!/^https:\/\//.test(u) || isPrivateHost(u)) return 'only public https URLs are allowed';
      const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FDE-Job-Finder-Agent' } });
      return `${r.status}\n${trim(await r.text(), 6000)}`;
    }
    case 'ask_agent': {
      if (ctx.depth >= 1) return 'delegation depth limit reached — do it yourself';
      const name = String(args.agent || '').toLowerCase();
      const all = await listAgents(ctx.a.owner);
      const target = all.find((x) => ctx.a.canCall.includes(x.id) && (x.name.toLowerCase() === name || x.name.toLowerCase().includes(name)));
      if (!target) return `not allowed — you can only call: ${all.filter((x) => ctx.a.canCall.includes(x.id)).map((x) => x.name).join(', ') || 'nobody'}`;
      const left = ctx.deadline - Date.now() - 40000;
      if (left < 45000) return 'not enough time left to delegate';
      const r = await runAgentDef(target, 'delegate', String(args.task || ''), Math.min(left, 120000), ctx.depth + 1);
      return r.report ? `${target.name} reports: ${r.report.title}\n${r.report.summary}\n${r.report.findings.map((f) => `- ${f.title}: ${f.detail} ${f.url || ''}`).join('\n')}` : `${target.name} failed: ${r.error}`;
    }
  }
  return 'unknown tool';
}

/** System prompt pieces: identity + orders + thinking design + skills (only the ones this agent / member was given). */
function skillText(ctx: Ctx, ids: string[]): string {
  const sk = ctx.skills.filter((x) => ids.includes(x.id));
  if (!sk.length) return '';
  let out = 'YOUR SKILLS (apply them whenever relevant):\n';
  for (const x of sk) out += x.kind === 'api' ? `- ${x.name}: ${x.description} → call tool skill_${slug(x.name)} with {"input":"…"}${x.instructions ? `. How to use: ${x.instructions.slice(0, 800)}` : ''}\n` : `## SKILL: ${x.name}${x.description ? ` — ${x.description}` : ''}\n${x.instructions.slice(0, 4000)}\n`;
  return out.slice(0, 14000);
}
function toolSet(ctx: Ctx, tools: ToolId[], skillIds: string[]): string[] {
  const sk = ctx.skills.filter((x) => skillIds.includes(x.id));
  const fromSkills = sk.flatMap((x) => x.tools);
  const apiTools = sk.filter((x) => x.kind === 'api').map((x) => `skill_${slug(x.name)}`);
  return Array.from(new Set([...tools, ...fromSkills, ...apiTools])).filter((t) => t !== 'ask_agent' || ctx.a.canCall.length);
}
function toolDoc(ctx: Ctx, tools: string[]): string {
  return tools.map((t) => {
    if (t.startsWith('skill_')) { const sk = ctx.skills.find((x) => `skill_${slug(x.name)}` === t); return `- ${t}: ${sk?.description || 'custom API skill'}. args {"input":""}`; }
    return `- ${t}: ${TOOLS[t as ToolId].desc}. args ${TOOLS[t as ToolId].args}`;
  }).join('\n');
}
const tokens = (d: Depth) => (d === 'fast' ? 1300 : d === 'deep' ? 2000 : 3000);
type LlmOpts = { profileId?: string; model?: string; strict?: boolean };
const llm = (m: ModelRef | undefined, fb?: ModelRef): LlmOpts => { const r = m?.profileId ? m : fb; return r?.profileId ? { profileId: r.profileId, model: r.model || undefined, strict: r.strict } : {}; };
async function ask<T>(ctx: Ctx, system: string, user: string, ref: LlmOpts, maxTokens: number, timeoutMs = 60000) {
  const t = Math.max(15000, Math.min(timeoutMs, ctx.deadline - Date.now() - 8000));
  const r = await chatJson<T>(system, user, { ...ref, maxTokens, timeoutMs: t });
  ctx.models.add(`${r.meta.provider} · ${r.meta.model}`);
  return r.data;
}

// ---------- the reasoning loop (ReAct) for one agent / member ----------
async function react(ctx: Ctx, o: { who: string; system: string; task: string; tools: string[]; maxSteps: number; deadline: number; ref: LlmOpts }): Promise<string> {
  const doc = toolDoc(ctx, o.tools);
  const depth = ctx.a.thinking.depth;
  const trace: string[] = [];
  for (let i = 0; i < o.maxSteps; i++) {
    if (Date.now() > o.deadline - 25000) break;
    const data = await ask<{ thought: string; action?: { tool: string; args: Record<string, unknown> }; final?: string }>(ctx,
      `${o.system}\n\n${OBEY}`,
      `TASK:\n${o.task}\n\nTOOLS you can call:\n${doc || '(none — answer from reasoning)'}\n\nWHAT YOU DID SO FAR:\n${trace.join('\n\n') || '(nothing yet)'}\n\nStep ${i + 1} of max ${o.maxSteps}. ${DEPTH_PROMPT[depth]} Decide the single best next move. If you have enough evidence, give the final answer.\nJSON: {"thought":"your reasoning","action":{"tool":"tool_id","args":{}}} OR {"thought":"","final":"complete answer with facts, sources (URLs) and recommendations"}`,
      o.ref, tokens(depth), Math.min(90000, o.deadline - Date.now() - 15000));
    if (!data) break;
    if (data.final || !data.action || !o.tools.includes(data.action.tool)) { ctx.steps.push({ who: o.who, thought: data.thought || '', at: Date.now() }); if (data.final) return data.final; if (data.action) { trace.push(`(tool ${data.action.tool} is not available to you)`); continue; } return data.thought || ''; }
    let obs: string;
    try { obs = await runTool(ctx, data.action.tool, data.action.args || {}); } catch (e) { obs = `tool error: ${(e as Error).message.slice(0, 200)}`; }
    ctx.seen.push(obs);
    ctx.steps.push({ who: o.who, thought: data.thought || '', tool: data.action.tool, args: data.action.args, observation: trim(obs, 1500), at: Date.now() });
    trace.push(`THOUGHT: ${data.thought}\nACTION: ${data.action.tool} ${JSON.stringify(data.action.args)}\nRESULT:\n${trim(obs, 2500)}`);
  }
  const data = await ask<{ final: string }>(ctx, `${o.system}\n\n${OBEY}`, `TASK:\n${o.task}\n\nEVIDENCE:\n${trace.join('\n\n').slice(-12000)}\n\nWrite the best final answer now from this evidence. JSON: {"final":""}`, o.ref, 2500).catch(() => null);
  return data?.final || trace.slice(-1)[0] || 'No result';
}

// ---------- agentic modes ----------
function memberCtx(ctx: Ctx, base: string, m: Member) {
  return { system: `${base}\nYou are team member "${m.name}" — ${m.role}.\n${m.instructions}\n${skillText(ctx, m.skills)}`, tools: toolSet(ctx, m.tools, m.skills), ref: llm(m.model, ctx.a.model) };
}
async function work(ctx: Ctx, base: string, task: string): Promise<string> {
  const a = ctx.a;
  const me = { system: `${base}\n${skillText(ctx, a.skills)}`, tools: toolSet(ctx, a.tools, a.skills), ref: llm(a.model) };
  const dl = ctx.deadline - (a.supervisor.enabled ? 70000 : 30000);
  const solo = (t: string, steps = a.maxSteps, deadline = dl) => react(ctx, { who: a.name, ...me, task: t, maxSteps: steps, deadline });
  const half = Math.max(3, Math.floor(a.maxSteps / 2));
  switch (a.type) {
    case 'plan_execute': {
      const plan = await ask<{ steps: string[] }>(ctx, `${me.system}\n${OBEY}`, `TASK: ${task}\nTools available: ${me.tools.join(', ')}\nWrite the shortest plan that fully completes it (2-6 concrete steps). JSON: {"steps":[""]}`, me.ref, 1200);
      const steps = (plan?.steps || []).slice(0, 6);
      ctx.steps.push({ who: 'Planner', thought: steps.map((x, i) => `${i + 1}. ${x}`).join('\n') || 'no plan — solving directly', at: Date.now() });
      if (!steps.length) return solo(task);
      let done = '';
      for (const [i, st] of steps.entries()) {
        if (Date.now() > dl - 30000) { done += `\n(step ${i + 1}+ skipped: time budget)`; break; }
        const out = await solo(`OVERALL TASK: ${task}\nCURRENT STEP ${i + 1}/${steps.length}: ${st}\nRESULTS OF EARLIER STEPS:\n${done.slice(-6000) || '(none)'}`, Math.max(2, Math.ceil(a.maxSteps / steps.length) + 1));
        done += `\n### Step ${i + 1}: ${st}\n${out}`;
      }
      return done;
    }
    case 'reflexion': {
      let out = await solo(task, half, dl - 60000);
      for (let r = 0; r < 2 && Date.now() < dl - 50000; r++) {
        const c = await ask<{ ok: boolean; lessons: string[] }>(ctx, `You critique your own work brutally. ${OBEY}`, `INSTRUCTIONS:\n${a.goal}\nRULES:\n${a.rules}\nTASK: ${task}\nMY ANSWER:\n${out.slice(0, 9000)}\nWhat is missing, wrong, unsupported or against the rules? JSON: {"ok":true|false,"lessons":[""]}`, me.ref, 900);
        ctx.steps.push({ who: 'Self-critique', thought: c?.ok ? 'good enough' : (c?.lessons || []).join('\n'), at: Date.now() });
        if (!c || c.ok || !c.lessons?.length) break;
        out = await solo(`${task}\n\nYOUR PREVIOUS ATTEMPT:\n${out.slice(0, 5000)}\n\nLESSONS — fix all of these:\n- ${c.lessons.join('\n- ')}`, half);
      }
      return out;
    }
    case 'tree': {
      const t = await ask<{ approaches: { name: string; how: string; score: number; why: string }[] }>(ctx, `${me.system}\n${OBEY}`, `TASK: ${task}\nTools: ${me.tools.join(', ')}\nPropose 3 genuinely different approaches, score each 1-10 for (likely quality of result × feasibility with these tools), be harsh. JSON: {"approaches":[{"name":"","how":"","score":0,"why":""}]}`, me.ref, 1500);
      const ap = (t?.approaches || []).sort((x, y) => y.score - x.score);
      ctx.steps.push({ who: 'Tree of thought', thought: ap.map((x) => `${x.score}/10 ${x.name}: ${x.how} — ${x.why}`).join('\n') || 'no branches', at: Date.now() });
      return solo(ap[0] ? `${task}\n\nUSE THIS APPROACH (best of ${ap.length}): ${ap[0].name} — ${ap[0].how}` : task);
    }
    case 'team': {
      const plan = await ask<{ assignments: { member: string; subtask: string }[]; note: string }>(ctx, `${base}\nYou are the LEAD of a team: ${a.members.map((m) => `${m.name} (${m.role})`).join(', ')}.\n${OBEY}`, `TASK: ${task}\nSplit the work into one sub-task per useful member (skip members not needed). JSON: {"assignments":[{"member":"exact member name","subtask":""}],"note":"plan in one line"}`, me.ref, 1200);
      ctx.steps.push({ who: 'Lead', thought: `Plan: ${plan?.note || ''}\n${(plan?.assignments || []).map((x) => `→ ${x.member}: ${x.subtask}`).join('\n')}`, at: Date.now() });
      const res = await pool(plan?.assignments?.length ? plan.assignments : a.members.map((m) => ({ member: m.name, subtask: task })), 4, async (as) => {
        const m = a.members.find((x) => x.name.toLowerCase() === String(as.member).toLowerCase()) || a.members[0];
        return `### ${m.name} (${m.role})\n${await react(ctx, { who: m.name, ...memberCtx(ctx, base, m), task: as.subtask, maxSteps: half, deadline: dl - 30000 })}`;
      });
      const outputs = res.map((w) => (w.status === 'fulfilled' ? w.value : `(a member failed: ${(w.reason as Error)?.message})`)).join('\n\n');
      const crit = await ask<{ issues: string[] }>(ctx, `You are a harsh reviewer. ${OBEY}`, `Owner instructions:\n${a.goal}\nRules:\n${a.rules}\nTeam output:\n${outputs.slice(0, 14000)}\nList gaps, unsupported claims and rule violations. JSON: {"issues":[""]}`, me.ref, 900).catch(() => null);
      ctx.steps.push({ who: 'Critic', thought: (crit?.issues || []).join('\n') || 'no issues', at: Date.now() });
      return `${outputs}\n\nREVIEWER NOTES:\n${(crit?.issues || []).join('\n')}`;
    }
    case 'pipeline': {
      let prev = '';
      let all = '';
      for (const [i, m] of a.members.entries()) {
        if (Date.now() > dl - 30000) { all += `\n(${m.name} skipped: time budget)`; break; }
        const out = await react(ctx, { who: m.name, ...memberCtx(ctx, base, m), task: `OVERALL TASK: ${task}\nYou are stage ${i + 1}/${a.members.length} of a pipeline.\n${prev ? `OUTPUT OF THE PREVIOUS STAGE (build on it, do not redo it):\n${prev.slice(0, 7000)}` : 'You are the first stage.'}`, maxSteps: Math.max(2, Math.ceil(a.maxSteps / a.members.length) + 1), deadline: dl });
        prev = out;
        all += `\n### Stage ${i + 1} — ${m.name}\n${out}`;
      }
      return all;
    }
    case 'debate': {
      const res = await pool(a.members, 4, async (m) => ({ m, out: await react(ctx, { who: m.name, ...memberCtx(ctx, base, m), task: `${task}\nArgue your position (${m.role}) with hard evidence and links.`, maxSteps: half, deadline: dl - 50000 }) }));
      const opening = res.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ m: Member; out: string }>).value);
      const rebut = await pool(opening, 4, async ({ m }) => {
        const others = opening.filter((x) => x.m !== m).map((x) => `${x.m.name}: ${x.out.slice(0, 3000)}`).join('\n\n');
        const r = await ask<{ rebuttal: string }>(ctx, `${memberCtx(ctx, base, m).system}\n${OBEY}`, `TASK: ${task}\nOTHER SIDES SAID:\n${others}\nRebut their weakest points and concede what is true. JSON: {"rebuttal":""}`, llm(m.model, a.model), 1200).catch(() => null);
        ctx.steps.push({ who: `${m.name} (rebuttal)`, thought: r?.rebuttal || '', at: Date.now() });
        return `${m.name} rebuttal: ${r?.rebuttal || ''}`;
      });
      const transcript = opening.map((x) => `### ${x.m.name} (${x.m.role})\n${x.out}`).join('\n\n') + '\n\n' + rebut.map((r) => (r.status === 'fulfilled' ? r.value : '')).join('\n');
      const j = await ask<{ verdict: string; why: string; winner: string }>(ctx, `You are an impartial, brutally honest judge. ${OBEY}`, `TASK: ${task}\nOWNER INSTRUCTIONS: ${a.goal}\nDEBATE:\n${transcript.slice(0, 14000)}\nDecide on evidence only. JSON: {"winner":"","verdict":"the decision","why":""}`, me.ref, 1200);
      ctx.steps.push({ who: 'Judge', thought: `${j?.winner || ''}: ${j?.verdict || ''}\n${j?.why || ''}`, at: Date.now() });
      return `${transcript}\n\nJUDGE VERDICT: ${j?.verdict || ''} (winner: ${j?.winner || 'n/a'})\n${j?.why || ''}`;
    }
    case 'swarm': {
      const res = await pool(a.members, 4, async (m) => `### ${m.name}\n${await react(ctx, { who: m.name, ...memberCtx(ctx, base, m), task, maxSteps: half, deadline: dl - 30000 })}`);
      const outs = res.map((r) => (r.status === 'fulfilled' ? r.value : '')).filter(Boolean).join('\n\n');
      const v = await ask<{ consensus: string; disagreements: string[] }>(ctx, `You merge independent answers. Keep what several agree on, flag what only one claims. ${OBEY}`, `TASK: ${task}\nANSWERS:\n${outs.slice(0, 14000)}\nJSON: {"consensus":"merged best answer with links","disagreements":[""]}`, me.ref, 2500);
      ctx.steps.push({ who: 'Swarm vote', thought: `Disagreements: ${(v?.disagreements || []).join('; ') || 'none'}`, at: Date.now() });
      return `${v?.consensus || ''}\n\nDISAGREEMENTS: ${(v?.disagreements || []).join('; ')}\n\n${outs}`;
    }
    case 'router': {
      const r = await ask<{ member: string; why: string }>(ctx, `You route tasks. ${OBEY}`, `TASK: ${task}\nMEMBERS:\n${a.members.map((m) => `- ${m.name}: ${m.role}`).join('\n')}\nPick the single best member. JSON: {"member":"","why":""}`, me.ref, 400);
      const m = a.members.find((x) => x.name.toLowerCase() === String(r?.member || '').toLowerCase()) || a.members[0];
      ctx.steps.push({ who: 'Router', thought: `→ ${m.name}: ${r?.why || 'default'}`, at: Date.now() });
      return react(ctx, { who: m.name, ...memberCtx(ctx, base, m), task, maxSteps: a.maxSteps, deadline: dl });
    }
    default:
      return solo(task);
  }
}

// ---------- supervisor: compares what was asked vs what was done, sends it back until it passes ----------
async function supervise(ctx: Ctx, base: string, task: string, raw: string): Promise<{ raw: string; reviews: Review[]; approved: boolean }> {
  const a = ctx.a;
  const reviews: Review[] = [];
  const ref = llm(a.supervisor.model, a.model);
  for (let round = 1; round <= a.supervisor.maxRounds; round++) {
    const evidence = ctx.steps.filter((s) => s.tool).map((s) => `${s.who} used ${s.tool} ${JSON.stringify(s.args).slice(0, 150)}`).slice(-30).join('\n');
    // hard check, not opinion: links in the answer that never appeared in any tool result are probably invented
    const seen = `${ctx.seen.join(' ')} ${ctx.steps.map((s) => JSON.stringify(s.args || '')).join(' ')} ${a.goal} ${task}`;
    const urls = Array.from(new Set(raw.match(/https?:\/\/[^\s)\]"'<>]+/g) || [])).map((u) => u.replace(/[.,;]+$/, ''));
    const unverified = urls.filter((u) => !seen.includes(u.slice(0, 60)));
    const r = await ask<{ score: number; asked: string; done: string; gaps: string[]; fix: string }>(ctx,
      `You are the SUPERVISOR. You did not do this work. You are brutally honest, never polite, never fooled by confident wording. ${OBEY}`,
      `WHAT THE OWNER ASKED:\nInstructions: ${a.goal}\nRules: ${a.rules || '(none)'}\nThis run's task: ${task}\n${a.supervisor.criteria ? `OWNER'S PASS CRITERIA: ${a.supervisor.criteria}\n` : ''}
WHAT THE AGENTS ACTUALLY DID (tool calls):\n${evidence || '(no tools used)'}\n\nWHAT THEY DELIVERED:\n${raw.slice(0, 14000)}
${urls.length ? `LINK CHECK (computed, not opinion): ${urls.length - unverified.length}/${urls.length} links were really returned by tools.${unverified.length ? ` NOT seen in any tool result (likely invented — penalise hard, demand real ones): ${unverified.slice(0, 10).join(' ')}` : ''}\n` : ''}Compare item by item. Check: every instruction done? every rule obeyed? claims backed by sources/links? anything invented, stale, vague, or missing? Score 1-10 (10 = exactly what was asked, fully evidenced). JSON: {"score":0,"asked":"what was asked, one line","done":"what was actually done, one line","gaps":["specific gap"],"fix":"exact instructions to fix the gaps"}`,
      ref, 1400);
    if (!r) break;
    // invented links cap the score no matter how confident the reviewer model is
    const score = Math.max(0, Math.min(unverified.length ? Math.min(10, a.supervisor.passScore - 1) : 10, Number(r.score) || 0));
    if (unverified.length) r.gaps = [`${unverified.length} link(s) not found in any tool result — verify or replace: ${unverified.slice(0, 5).join(' ')}`, ...(r.gaps || [])];
    const rv: Review = { round, score, verdict: score >= a.supervisor.passScore ? 'pass' : 'fail', asked: r.asked || '', done: r.done || '', gaps: (r.gaps || []).slice(0, 12), fix: r.fix || '' };
    reviews.push(rv);
    ctx.steps.push({ who: `Supervisor (round ${round})`, thought: `${rv.verdict.toUpperCase()} ${score}/10 — asked: ${rv.asked} | done: ${rv.done}${rv.gaps.length ? `\nGaps:\n- ${rv.gaps.join('\n- ')}` : ''}`, at: Date.now() });
    if (rv.verdict === 'pass') return { raw, reviews, approved: true };
    if (round === a.supervisor.maxRounds || Date.now() > ctx.deadline - 75000) break;
    // send it back: the agent fixes exactly the gaps with all its tools
    const fix = await react(ctx, { who: `${a.name} (fixing round ${round})`, system: `${base}\n${skillText(ctx, a.skills)}`, tools: toolSet(ctx, [...new Set([...a.tools, ...a.members.flatMap((m) => m.tools)])], a.skills), ref: llm(a.model),
      task: `ORIGINAL TASK: ${task}\nYOUR WORK SO FAR:\n${raw.slice(0, 6000)}\n\nTHE SUPERVISOR REJECTED IT (${score}/10). Fix exactly these gaps:\n- ${rv.gaps.join('\n- ')}\nInstructions: ${rv.fix}\nReturn the complete corrected answer.`,
      maxSteps: Math.max(3, Math.floor(a.maxSteps / 2)), deadline: ctx.deadline - 45000 });
    raw = `${fix}\n\n(earlier draft, superseded where it conflicts)\n${raw.slice(0, 5000)}`;
  }
  return { raw, reviews, approved: false };
}

// ---------- run an agent ----------
export async function runAgentDef(a: AgentDef, trigger: Run['trigger'], extra?: string, budgetMs = 250000, depth = 0): Promise<Run> {
  a = normalize(a);
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const t0 = Date.now();
  const ctx: Ctx = { a, skills: await listSkills(a.owner), deadline: t0 + budgetMs, steps: [], depth, models: new Set(), seen: [] };
  const memory = await getJSON<string[]>(`studio:mem:${a.id}`, []);
  const prev = (await getRuns(a.id)).find((r) => r.report);
  const base = `You are "${a.name}", a custom AI agent built by your owner (a Bengaluru-based engineer moving into FDE / AI-ML roles). Today is ${new Date().toISOString().slice(0, 10)}.
YOUR INSTRUCTIONS FROM THE OWNER (follow exactly):\n${a.goal}\n${a.rules ? `RULES (never break):\n${a.rules}\n` : ''}HOW TO THINK: ${DEPTH_PROMPT[a.thinking.depth]}${a.thinking.style ? `\nTHINKING DESIGN FROM THE OWNER (follow it): ${a.thinking.style}` : ''}
${memory.length ? `YOUR MEMORY FROM EARLIER RUNS:\n- ${memory.slice(0, 25).join('\n- ')}\n` : ''}${prev?.report ? `LAST RUN (${prev.at.slice(0, 16)}) REPORTED: ${prev.report.title} — ${prev.report.findings.map((f) => f.title).slice(0, 12).join('; ')}\n` : ''}`;
  const task = extra ? `${extra}` : 'Do your job now, end to end.';
  let reviews: Review[] | undefined;
  let approved: boolean | undefined;
  try {
    let raw = await work(ctx, base, task);
    if (a.supervisor.enabled && Date.now() < ctx.deadline - 50000) {
      const s = await supervise(ctx, base, task, raw);
      raw = s.raw; reviews = s.reviews; approved = s.approved;
    }
    const last = reviews?.[reviews.length - 1];
    const rep = await ask<Report>(ctx, `${base}\n${OBEY}`,
      `Turn this work into the final report for your owner. Keep every concrete item (names, numbers, links). Be brutally honest about what was NOT achieved. ${a.report.onlyIfNew && prev?.report ? `Set newSinceLast=false if nothing meaningfully new vs the last run (${prev.report.findings.map((f) => f.title).slice(0, 15).join('; ')}).` : 'newSinceLast=true.'}
${last ? `SUPERVISOR: ${last.verdict.toUpperCase()} ${last.score}/10${last.gaps.length ? `, open gaps: ${last.gaps.join('; ')}` : ''} — mention unresolved gaps in the summary.\n` : ''}WORK:\n${raw.slice(0, 16000)}\nJSON: {"title":"","summary":"3-6 sentences","findings":[{"title":"","detail":"","url":""}],"actions":["what the owner should do next"],"newSinceLast":true}`, llm(a.model), 3500, 90000);
    const report: Report = rep ? { title: rep.title || a.name, summary: rep.summary || '', findings: (rep.findings || []).slice(0, 40), actions: rep.actions || [], newSinceLast: rep.newSinceLast !== false } : { title: a.name, summary: raw.slice(0, 2000), findings: [], actions: [], newSinceLast: true };
    if (reviews?.length && !approved) report.summary = `⚠ Supervisor did NOT approve (best ${Math.max(...reviews.map((r) => r.score))}/10 after ${reviews.length} round${reviews.length > 1 ? 's' : ''}). ${report.summary}`;
    const run: Run = { id: randomBytes(4).toString('hex'), agentId: a.id, at: new Date().toISOString(), ms: Date.now() - t0, trigger, steps: ctx.steps, report, delivered: [], reviews, approved, models: [...ctx.models] };
    if (trigger !== 'chat' && trigger !== 'delegate' && (!a.report.onlyIfNew || report.newSinceLast !== false)) run.delivered = await deliver(a, report);
    await saveRun(a, run, approved === false ? 'ok (supervisor not satisfied)' : 'ok');
    return run;
  } catch (e) {
    const run: Run = { id: randomBytes(4).toString('hex'), agentId: a.id, at: new Date().toISOString(), ms: Date.now() - t0, trigger, steps: ctx.steps, report: null, delivered: [], error: (e as Error).message.slice(0, 300), reviews, models: [...ctx.models] };
    await saveRun(a, run, `failed: ${run.error}`);
    return run;
  }
}
async function saveRun(a: AgentDef, run: Run, status: string) {
  const runs = await getRuns(a.id);
  await setJSON(`studio:runs:${a.id}`, [run, ...runs].slice(0, 40));
  await hset('studio:agents', a.id, { ...a, lastRun: run.at, lastStatus: status });
}

async function deliver(a: AgentDef, r: Report): Promise<string[]> {
  const out: string[] = ['in-app'];
  const to = a.report.email === 'me' ? (a.owner === 'owner' ? secret('DIGEST_TO') : a.owner) : a.report.email;
  if (a.report.email) {
    const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:680px;margin:auto"><div style="background:#0d1424;color:#fff;padding:16px 20px;border-radius:14px"><div style="opacity:.7;font-size:12px">${esc(a.emoji)} ${esc(a.name)} · ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div><div style="font-size:18px;font-weight:700">${esc(r.title)}</div></div><p>${esc(r.summary)}</p>${r.findings.map((f) => `<div style="padding:8px 0;border-bottom:1px solid #eee"><b>${f.url ? `<a href="${esc(f.url)}">${esc(f.title)}</a>` : esc(f.title)}</b><div style="color:#444;font-size:13px">${esc(f.detail)}</div></div>`).join('')}${r.actions.length ? `<h3>Do next</h3><ul>${r.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p style="color:#999;font-size:12px">Your custom agent · FDE Job Finder</p></div>`;
    try { await sendMail(to, `${a.emoji} ${r.title}`, html); out.push(`email ${to}`); } catch (e) { out.push(`email failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  if (a.report.whatsapp) {
    try { await sendWhatsApp(`${a.emoji} *${a.name}*: ${r.title}\n\n${r.summary.slice(0, 500)}\n\n${r.findings.slice(0, 6).map((f, i) => `${i + 1}. ${f.title}${f.url ? `\n${f.url}` : ''}`).join('\n')}${r.actions.length ? `\n\nDo next: ${r.actions.slice(0, 3).join(' · ')}` : ''}`); out.push('whatsapp'); } catch (e) { out.push(`whatsapp failed: ${(e as Error).message.slice(0, 80)}`); }
  }
  if (a.report.webhook && /^https:\/\//.test(a.report.webhook)) {
    try { const r2 = await fetch(a.report.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: a.name, ...r, text: `${a.emoji} ${a.name}: ${r.title}\n${r.summary}`, content: `${a.emoji} **${a.name}**: ${r.title}\n${r.summary}`.slice(0, 1900) }) }); out.push(`webhook ${r2.status}`); } catch (e) { out.push(`webhook failed: ${(e as Error).message.slice(0, 60)}`); }
  }
  return out;
}

// ---------- each agent's own chatbot ----------
export async function agentChat(a: AgentDef, text: string): Promise<{ reply: string; run: Run }> {
  const history = await getJSON<{ role: 'user' | 'agent'; text: string; at: string }[]>(`studio:chat:${a.id}`, []);
  const ctx = history.slice(-10).map((m) => `${m.role === 'user' ? 'OWNER' : 'YOU'}: ${m.text.slice(0, 800)}`).join('\n');
  const run = await runAgentDef(a, 'chat', `${ctx ? `Conversation so far:\n${ctx}\n\n` : ''}The owner now says: ${text}\nDo what they ask (use your tools as needed) and answer them directly.`, 200000);
  const reply = run.report ? `**${run.report.title}**\n\n${run.report.summary}${run.report.findings.length ? `\n\n${run.report.findings.map((f) => `- **${f.title}** — ${f.detail}${f.url ? ` (${f.url})` : ''}`).join('\n')}` : ''}${run.report.actions.length ? `\n\n**Next:**\n${run.report.actions.map((x) => `- ${x}`).join('\n')}` : ''}` : `Failed: ${run.error}`;
  const now = new Date().toISOString();
  await setJSON(`studio:chat:${a.id}`, [...history, { role: 'user', text, at: now }, { role: 'agent', text: reply, at: now }].slice(-60));
  return { reply, run };
}
export async function getAgentChat(id: string) { return getJSON<{ role: 'user' | 'agent'; text: string; at: string }[]>(`studio:chat:${id}`, []); }

// ---------- 24×7 scheduler ----------
const EVERY: Record<Schedule, number> = { manual: Infinity, hourly: 1, '2h': 2, '6h': 6, '12h': 12, daily: 24, weekly: 168 };
export function isDue(a: AgentDef, now = Date.now()): boolean {
  if (!a.enabled || a.schedule === 'manual') return false;
  const last = a.lastRun ? Date.parse(a.lastRun) : 0;
  const hrs = (now - last) / 36e5;
  if (a.schedule === 'daily' || a.schedule === 'weekly') {
    const istHour = (new Date(now).getUTCHours() + 5.5) % 24;
    return hrs >= EVERY[a.schedule] - 1.5 && istHour >= a.dailyHour;
  }
  return hrs >= EVERY[a.schedule] - 0.25;
}
export async function runDueAgents(budgetMs = 270000) {
  const t0 = Date.now();
  const all = Object.values(await hgetall<AgentDef>('studio:agents')).filter((a) => isDue(a)).sort((a, b) => (a.lastRun || '').localeCompare(b.lastRun || ''));
  const log: string[] = [];
  for (const a of all) {
    const left = budgetMs - (Date.now() - t0);
    if (left < 70000) { log.push('time budget used — the rest run next hour'); break; }
    const r = await runAgentDef(a, 'schedule', undefined, Math.min(left - 10000, 200000));
    log.push(`${a.name}: ${r.error ? `failed ${r.error}` : `${r.report?.title} → ${r.delivered.join(', ')}`}`);
  }
  return { due: all.length, log };
}
