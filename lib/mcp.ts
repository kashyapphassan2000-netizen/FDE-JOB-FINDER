import { track } from './obs';
import { createHash, randomBytes } from 'node:crypto';
import { hdel, hgetall, hset } from './store';
import { roleOf } from './access';
import { tenant, tenantFor, type Tenant } from './tenant';
import { ownerEmails } from './access';
import { getJobs } from './refresh';
import { getSem } from './semantic';
import { careersSearch } from './careersearch';
import { analyzeJob } from './analyzer';
import { referralReport } from './referrals';
import { readPage, webSearch } from './search';
import { newsSearch } from './news';
import { radarState } from './radar';
import { getJSON } from './store';
import { getCv } from './cv';
import { getWorld } from './mentor';
import { listAgents, listSkills, runAgentDef, saveAgent, type AgentDef } from './studio'; // the studio ENGINE powers deep research; the Agent studio page itself was removed
import { spend } from './limits';

/**
 * MCP server (Model Context Protocol, Streamable HTTP, JSON responses) so ANY agent harness — Claude Code, Claude Code
 * via free-claude-code (any model: NVIDIA NIM, OpenRouter, Groq, Ollama, LM Studio…), Codex, OpenCode, Cline — can
 * use this app's tools and your skills. Auth: a personal bearer token (Agent studio → Connect Claude Code). Each token
 * acts as its user (own data, own limits) and dies when that user's access ends.
 */
const H = (t: string) => createHash('sha256').update(t).digest('hex');
export interface McpToken { label: string; email: string; createdAt: string; lastUsed?: string }
export async function createToken(email: string, label: string): Promise<string> {
  const t = `fdejf_${randomBytes(24).toString('base64url')}`;
  await hset('mcp:tokens', H(t), { label: label.slice(0, 40) || 'Claude Code', email, createdAt: new Date().toISOString() } satisfies McpToken);
  return t;
}
export async function listTokens(email: string) {
  return Object.entries(await hgetall<McpToken>('mcp:tokens')).filter(([, v]) => v.email === email).map(([h, v]) => ({ id: h.slice(0, 12), ...v }));
}
export async function revokeToken(email: string, id: string) {
  for (const [h, v] of Object.entries(await hgetall<McpToken>('mcp:tokens'))) if (v.email === email && h.startsWith(id)) await hdel('mcp:tokens', h);
}
export async function tenantForToken(auth: string | null): Promise<Tenant | null> {
  const t = (auth || '').replace(/^Bearer\s+/i, '').trim();
  if (!t.startsWith('fdejf_')) return null;
  const h = H(t);
  const rec = (await hgetall<McpToken>('mcp:tokens'))[h];
  if (!rec || !(await roleOf(rec.email))) return null; // removed / expired users' tokens stop working
  if (!rec.lastUsed || Date.now() - Date.parse(rec.lastUsed) > 6e5) await hset('mcp:tokens', h, { ...rec, lastUsed: new Date().toISOString() });
  return tenantFor(rec.email, ownerEmails());
}

type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; cost: number; run: (a: Record<string, any>) => Promise<unknown> };
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required });
const S = (d: string) => ({ type: 'string', description: d });
const N = (d: string) => ({ type: 'number', description: d });

async function researchAgent(): Promise<AgentDef> {
  const ns = tenant().ns;
  const ex = (await listAgents(ns)).find((a) => a.name === 'Deep research (Claude Code)');
  return ex || saveAgent(ns, { name: 'Deep research (Claude Code)', emoji: '🔬', type: 'deep_research', goal: 'Research the topic given by Claude Code in depth and write a decision-grade report with citations.', rules: 'Every claim cited. Prefer primary sources and recent data.', tools: ['web_search', 'read_page', 'news'], thinking: { depth: 'deep', style: '' } });
}

export const MCP_TOOLS: Tool[] = [
  { name: 'search_jobs', cost: 0, description: 'Search the live FDE / AI-ML job feed (Bengaluru + India-eligible remote), with AI fit scores when ranked. Returns title, company, location, posted date, fit, url.', inputSchema: obj({ query: S('words that must appear, e.g. "forward deployed bengaluru"'), limit: N('max results, default 25') }),
    run: async (a) => { const [jobs, sem] = await Promise.all([getJobs(), getSem()]); const ws = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean); return jobs.filter((j) => ws.every((w) => `${j.title} ${j.company} ${j.location} ${j.description || ''}`.toLowerCase().includes(w))).sort((x, y) => (sem[y.id]?.r ?? sem[y.id]?.s ?? 0) - (sem[x.id]?.r ?? sem[x.id]?.s ?? 0) || y.score - x.score).slice(0, Math.min(100, Number(a.limit) || 25)).map((j) => ({ title: j.title, company: j.company, location: j.location, posted: j.postedAt || j.firstSeen, fit: sem[j.id]?.r, why: sem[j.id]?.why, flags: j.flags, url: j.url })); } },
  { name: 'careers_search', cost: 0, description: 'Search ~280 company job boards directly (Greenhouse, Ashby, Lever, Workday…) for a role, ranked by the user\'s priorities.', inputSchema: obj({ role: S('role, e.g. "forward deployed engineer"') }, ['role']),
    run: async (a) => { const r = await careersSearch({ q: String(a.role), limit: 40 }); return { total: r.total, companies: r.companies, hits: r.hits.slice(0, 40) }; } },
  { name: 'analyze_job', cost: 1, description: 'Deep job analysis: role decode, company research, interview rounds and questions (reported vs likely), CV fit, referral route. Give a job URL or pasted JD text.', inputSchema: obj({ url: S('job posting URL'), text: S('or the JD text'), company: S('company (optional)') }),
    run: async (a) => analyzeJob({ url: a.url, text: a.text, company: a.company }) },
  { name: 'find_referrals', cost: 1, description: 'Find recruiters, hiring managers and engineers who can refer at a company, with emails (found or pattern-guessed, labelled) and outreach messages.', inputSchema: obj({ company: S('company name'), role: S('target role (optional)') }, ['company']),
    run: async (a) => referralReport(String(a.company), String(a.role || '')) },
  { name: 'deep_research', cost: 2, description: 'Multi-round deep research on any topic: plans sub-questions, searches wide, reads 10-25 sources, follows gaps, returns a long cited markdown report. Takes 2-4 minutes.', inputSchema: obj({ topic: S('the research question') }, ['topic']),
    run: async (a) => { const r = await runAgentDef(await researchAgent(), 'chat', String(a.topic).slice(0, 2000), 270000); return r.report ? { title: r.report.title, report: r.report.body || r.report.summary, sources: r.report.sources, approved: r.approved } : { error: r.error }; } },
  { name: 'web_search', cost: 0, description: 'Web search (rotating engines). recency: day|week|month|any.', inputSchema: obj({ query: S('query'), recency: S('day|week|month|any') }, ['query']),
    run: async (a) => (await webSearch(String(a.query), 10, (['day', 'week', 'month', 'any'].includes(a.recency) ? a.recency : 'month') as 'month')).results },
  { name: 'read_page', cost: 0, description: 'Read any web page (JS-rendered) as text.', inputSchema: obj({ url: S('https URL') }, ['url']), run: async (a) => (await readPage(String(a.url), 15000)).slice(0, 15000) },
  { name: 'news', cost: 0, description: 'Dated news (Google + Bing News) for the last N days.', inputSchema: obj({ query: S('query'), days: N('1-60') }, ['query']),
    run: async (a) => (await newsSearch([String(a.query)], Math.max(1, Math.min(60, Number(a.days) || 7)), { perQuery: 15 })).items.slice(0, 20) },
  { name: 'zero_day_radar', cost: 0, description: 'Hiring signals before jobs are posted: AI companies that just added vLLM / SGLang / Triton / Ray etc. to their code, and new tech raises (SEC Form D) with their job boards.', inputSchema: obj({}), run: async () => radarState() },
  { name: 'market_today', cost: 0, description: 'Today\'s AI-jobs market picture: summary, hot skills, layoffs, hiring radar, tech, quantum, money news.', inputSchema: obj({}), run: async () => getWorld() },
  { name: 'my_cv', cost: 0, description: 'The user\'s CV text and extracted skills.', inputSchema: obj({}), run: async () => { const cv = await getCv(); return { text: cv.text.slice(0, 15000), skills: cv.skills }; } },
  { name: 'resume_gap', cost: 0, description: 'Latest weekly resume-gap report: what this week\'s top AI roles ask for vs the CV, with trends and the 5 gaps to close first.', inputSchema: obj({}), run: async () => (await getJSON<unknown[]>('gap:reports', []))[0] || { note: 'no report yet — run it in the app (CV tab)' } },
];

export async function skillPrompts() {
  return (await listSkills(tenant().ns)).filter((s) => s.kind === 'prompt').map((s) => ({ name: s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: s.name, description: s.description || s.instructions.slice(0, 120), text: s.instructions }));
}

/** One JSON-RPC message → response (null for notifications). */
export async function handleRpc(msg: { jsonrpc?: string; id?: number | string | null; method?: string; params?: any }): Promise<unknown | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!msg.method) return err(-32600, 'invalid request');
  if (msg.id === undefined || msg.method.startsWith('notifications/')) return null;
  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: 'fde-job-finder', version: '1.0.0' }, instructions: 'Tools for an AI / FDE job hunt: live job feed with AI fit scores, every company job board, job analysis + interview prep, referrals, zero-day hiring signals, deep research. The user\'s skills are available as prompts.' });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const t = MCP_TOOLS.find((x) => x.name === msg.params?.name);
      if (!t) return err(-32602, `unknown tool ${msg.params?.name}`);
      try {
        if (t.cost && tenant().role === 'member') await spend(tenant().ns, t.cost);
        const t0 = Date.now();
        const out = await t.run(msg.params?.arguments || {}).catch(async (e) => { await track('mcp', t.name, 'fail', (e as Error).message, Date.now() - t0); throw e; });
        await track('mcp', t.name, 'ok', JSON.stringify(msg.params?.arguments || {}).slice(0, 200), Date.now() - t0);
        const text = typeof out === 'string' ? out : JSON.stringify(out, null, 1);
        return ok({ content: [{ type: 'text', text: text.slice(0, 90000) }], isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    case 'prompts/list': return ok({ prompts: (await skillPrompts()).map(({ name, title, description }) => ({ name, title, description })) });
    case 'prompts/get': {
      const p = (await skillPrompts()).find((x) => x.name === msg.params?.name);
      if (!p) return err(-32602, 'unknown prompt');
      return ok({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: `Apply this skill of mine — ${p.title}:\n\n${p.text}` } }] });
    }
    case 'resources/list': return ok({ resources: [] });
    default: return err(-32601, `method not found: ${msg.method}`);
  }
}
