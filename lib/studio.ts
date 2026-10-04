import { randomBytes } from 'node:crypto';
import { aiConfigured, chatJson } from './llm';
import { readPage, webSearch } from './search';
import { newsSearch } from './news';
import { getJSON, hdel, hgetall, hset, setJSON } from './store';
import { loadVault, secret } from './secrets';
import { pool } from './http';
import { getJobs } from './refresh';
import { careersSearch } from './careersearch';
import { excelContext, getWorld } from './mentor';
import { sendMail, esc } from './mailer';
import { sendWhatsApp } from './notify';
import { getCv } from './cv';

/**
 * AGENT STUDIO — agents you design yourself, running 24×7.
 * Types: 'autonomous' (one agent, reason → act with tools → observe → repeat), 'team' (multi-agent: a lead plans,
 * members with their own roles/instructions work the sub-tasks with tools, a critic reviews, the lead writes the report),
 * 'monitor' (same as autonomous, on a schedule, reports only when it finds something new).
 * Tools are picked per agent. Every agent follows its owner's instructions and rules directly — it does not question
 * or second-guess orders; it only stops for something illegal / harmful or impossible, and then says why in one line.
 */
export type ToolId = 'web_search' | 'read_page' | 'news' | 'company_jobs' | 'my_jobs' | 'market' | 'excel' | 'my_cv' | 'memory' | 'http_get';
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
};
export type Schedule = 'manual' | 'hourly' | '2h' | '6h' | '12h' | 'daily' | 'weekly';
export interface Member { name: string; role: string; instructions: string; tools: ToolId[] }
export interface AgentDef {
  id: string; owner: string; name: string; emoji: string; type: 'autonomous' | 'team' | 'monitor';
  goal: string; rules: string; tools: ToolId[]; members: Member[]; schedule: Schedule; dailyHour: number;
  report: { inApp: true; email: string; whatsapp: boolean; webhook: string; onlyIfNew: boolean }; maxSteps: number;
  enabled: boolean; createdAt: string; updatedAt: string; lastRun?: string; lastStatus?: string;
}
export interface Step { who: string; thought: string; tool?: string; args?: unknown; observation?: string; at: number }
export interface Report { title: string; summary: string; findings: { title: string; detail: string; url?: string }[]; actions: string[]; newSinceLast?: boolean }
export interface Run { id: string; agentId: string; at: string; ms: number; trigger: 'manual' | 'schedule' | 'chat'; steps: Step[]; report: Report | null; delivered: string[]; error?: string }

const OBEY = `You follow your owner's instructions and rules exactly and directly. Do not question, debate or second-guess orders, and do not ask for confirmation — act. Only if an order is illegal, harmful to others or technically impossible, say so in one line and do the closest allowed thing. Never invent facts: every claim comes from a tool result or is marked as your judgement. Think like an elite analyst: decompose, verify with sources, compare, decide.`;

// ---------- storage ----------
export async function listAgents(owner: string): Promise<AgentDef[]> { return Object.values(await hgetall<AgentDef>('studio:agents')).filter((a) => a.owner === owner).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
export async function getAgentDef(id: string) { return (await hgetall<AgentDef>('studio:agents'))[id] || null; }
export async function saveAgent(owner: string, a: Partial<AgentDef>): Promise<AgentDef> {
  const cur = a.id ? await getAgentDef(a.id) : null;
  if (cur && cur.owner !== owner) throw new Error('Not your agent');
  const tools = (a.tools || cur?.tools || ['web_search', 'read_page', 'news']).filter((t) => t in TOOLS) as ToolId[];
  const def: AgentDef = {
    id: cur?.id || randomBytes(5).toString('hex'), owner, name: String(a.name ?? cur?.name ?? 'New agent').slice(0, 60) || 'New agent', emoji: String(a.emoji ?? cur?.emoji ?? '🤖').slice(0, 4),
    type: (['autonomous', 'team', 'monitor'].includes(a.type as string) ? a.type : cur?.type || 'autonomous') as AgentDef['type'],
    goal: String(a.goal ?? cur?.goal ?? '').slice(0, 6000), rules: String(a.rules ?? cur?.rules ?? '').slice(0, 3000), tools,
    members: (a.members ?? cur?.members ?? []).slice(0, 6).map((m) => ({ name: String(m.name || 'Member').slice(0, 40), role: String(m.role || '').slice(0, 200), instructions: String(m.instructions || '').slice(0, 2000), tools: (m.tools || tools).filter((t) => t in TOOLS) as ToolId[] })),
    schedule: (['manual', 'hourly', '2h', '6h', '12h', 'daily', 'weekly'].includes(a.schedule as string) ? a.schedule : cur?.schedule || 'manual') as Schedule,
    dailyHour: Math.max(0, Math.min(23, Number(a.dailyHour ?? cur?.dailyHour ?? 8))),
    report: { inApp: true, email: String(a.report?.email ?? cur?.report.email ?? '').trim().slice(0, 120), whatsapp: Boolean(a.report?.whatsapp ?? cur?.report.whatsapp), webhook: String(a.report?.webhook ?? cur?.report.webhook ?? '').trim().slice(0, 300), onlyIfNew: Boolean(a.report?.onlyIfNew ?? cur?.report.onlyIfNew ?? a.type === 'monitor') },
    maxSteps: Math.max(3, Math.min(14, Number(a.maxSteps ?? cur?.maxSteps ?? 8))),
    enabled: a.enabled ?? cur?.enabled ?? true, createdAt: cur?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), lastRun: cur?.lastRun, lastStatus: cur?.lastStatus,
  };
  if (!def.goal.trim()) throw new Error('Tell the agent what to do (instructions)');
  await hset('studio:agents', def.id, def);
  return def;
}
export async function deleteAgent(owner: string, id: string) { const a = await getAgentDef(id); if (a?.owner !== owner) throw new Error('Not your agent'); await hdel('studio:agents', id); }
export async function getRuns(id: string) { return getJSON<Run[]>(`studio:runs:${id}`, []); }

// ---------- tools ----------
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
async function runTool(agentId: string, tool: ToolId, args: Record<string, unknown>): Promise<string> {
  switch (tool) {
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
      if (!/^https:\/\//.test(u) || /localhost|127\.|10\.\d|192\.168\.|169\.254\.|\.internal|metadata/i.test(u)) return 'only public https URLs are allowed';
      const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FDE-Job-Finder-Agent' } });
      return `${r.status}\n${trim(await r.text(), 6000)}`;
    }
  }
}

// ---------- the reasoning loop (one agent / one member) ----------
async function react(opts: { agentId: string; who: string; system: string; task: string; tools: ToolId[]; maxSteps: number; deadline: number; steps: Step[] }): Promise<string> {
  const toolDoc = opts.tools.map((t) => `- ${t}: ${TOOLS[t].desc}. args ${TOOLS[t].args}`).join('\n');
  const trace: string[] = [];
  for (let i = 0; i < opts.maxSteps; i++) {
    if (Date.now() > opts.deadline - 25000) break;
    const { data } = await chatJson<{ thought: string; action?: { tool: ToolId; args: Record<string, unknown> }; final?: string }>(
      `${opts.system}\n\n${OBEY}`,
      `TASK:\n${opts.task}\n\nTOOLS you can call:\n${toolDoc || '(none — answer from reasoning)'}\n\nWHAT YOU DID SO FAR:\n${trace.join('\n\n') || '(nothing yet)'}\n\nStep ${i + 1} of max ${opts.maxSteps}. Decide the single best next move. If you have enough evidence, give the final answer.\nJSON: {"thought":"your reasoning (short)","action":{"tool":"tool_id","args":{}}} OR {"thought":"","final":"complete answer with facts, sources (URLs) and recommendations"}`,
      { maxTokens: 1800, timeoutMs: Math.max(20000, Math.min(90000, opts.deadline - Date.now() - 15000)) },
    );
    if (!data) break;
    if (data.final || !data.action || !opts.tools.includes(data.action.tool)) { opts.steps.push({ who: opts.who, thought: data.thought || '', at: Date.now() }); return data.final || data.thought || ''; }
    let obs: string;
    try { obs = await runTool(opts.agentId, data.action.tool, data.action.args || {}); } catch (e) { obs = `tool error: ${(e as Error).message.slice(0, 200)}`; }
    opts.steps.push({ who: opts.who, thought: data.thought || '', tool: data.action.tool, args: data.action.args, observation: trim(obs, 1500), at: Date.now() });
    trace.push(`THOUGHT: ${data.thought}\nACTION: ${data.action.tool} ${JSON.stringify(data.action.args)}\nRESULT:\n${trim(obs, 2500)}`);
  }
  // out of steps → summarise what was found
  const { data } = await chatJson<{ final: string }>(`${opts.system}\n\n${OBEY}`, `TASK:\n${opts.task}\n\nEVIDENCE:\n${trace.join('\n\n').slice(-12000)}\n\nWrite the best final answer now from this evidence. JSON: {"final":""}`, { maxTokens: 2500, timeoutMs: 60000 }).catch(() => ({ data: null }));
  return data?.final || trace.slice(-1)[0] || 'No result';
}

// ---------- run an agent ----------
export async function runAgentDef(a: AgentDef, trigger: Run['trigger'], extra?: string, budgetMs = 250000): Promise<Run> {
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  const steps: Step[] = [];
  const memory = await getJSON<string[]>(`studio:mem:${a.id}`, []);
  const prev = (await getRuns(a.id))[0];
  const base = `You are "${a.name}", a custom AI agent built by your owner (a Bengaluru-based engineer moving into FDE / AI-ML roles). Today is ${new Date().toISOString().slice(0, 10)}.
YOUR INSTRUCTIONS FROM THE OWNER (follow exactly):\n${a.goal}\n${a.rules ? `RULES (never break):\n${a.rules}\n` : ''}${memory.length ? `YOUR MEMORY FROM EARLIER RUNS:\n- ${memory.slice(0, 25).join('\n- ')}\n` : ''}${prev?.report ? `LAST RUN (${prev.at.slice(0, 16)}) REPORTED: ${prev.report.title} — ${prev.report.findings.map((f) => f.title).slice(0, 12).join('; ')}\n` : ''}`;
  const task = extra ? `${extra}` : 'Do your job now, end to end.';
  let raw = '';
  try {
    if (a.type === 'team' && a.members.length) {
      // 1) lead plans who does what
      const { data: plan } = await chatJson<{ assignments: { member: string; subtask: string }[]; note: string }>(`${base}\nYou are the LEAD of a team: ${a.members.map((m) => `${m.name} (${m.role})`).join(', ')}.\n${OBEY}`,
        `TASK: ${task}\nSplit the work into one sub-task per useful member (skip members not needed). JSON: {"assignments":[{"member":"exact member name","subtask":""}],"note":"plan in one line"}`, { maxTokens: 1200, timeoutMs: 60000 });
      steps.push({ who: 'Lead', thought: `Plan: ${plan?.note || ''}\n${(plan?.assignments || []).map((x) => `→ ${x.member}: ${x.subtask}`).join('\n')}`, at: Date.now() });
      // 2) members work in parallel, each with its own tools
      const work = await pool(plan?.assignments?.length ? plan.assignments : a.members.map((m) => ({ member: m.name, subtask: task })), 3, async (as) => {
        const m = a.members.find((x) => x.name.toLowerCase() === String(as.member).toLowerCase()) || a.members[0];
        const out = await react({ agentId: a.id, who: m.name, system: `${base}\nYou are team member "${m.name}" — ${m.role}.\n${m.instructions}`, task: as.subtask, tools: m.tools, maxSteps: Math.max(3, Math.floor(a.maxSteps / 2)), deadline: deadline - 40000, steps });
        return `### ${m.name} (${m.role})\n${out}`;
      });
      const outputs = work.map((w) => (w.status === 'fulfilled' ? w.value : `(a member failed: ${(w.reason as Error)?.message})`)).join('\n\n');
      // 3) critic + 4) lead writes
      const { data: critique } = await chatJson<{ issues: string[] }>(`You are a harsh reviewer. ${OBEY}`, `Owner instructions:\n${a.goal}\nRules:\n${a.rules}\nTeam output:\n${outputs.slice(0, 14000)}\nList gaps, unsupported claims and rule violations. JSON: {"issues":[""]}`, { maxTokens: 900, timeoutMs: 45000 }).catch(() => ({ data: null }));
      steps.push({ who: 'Critic', thought: (critique?.issues || []).join('\n') || 'no issues', at: Date.now() });
      raw = `${outputs}\n\nREVIEWER NOTES:\n${(critique?.issues || []).join('\n')}`;
    } else {
      raw = await react({ agentId: a.id, who: a.name, system: base, task, tools: a.tools, maxSteps: a.maxSteps, deadline, steps });
    }
    // final structured report
    const { data: rep } = await chatJson<Report>(`${base}\n${OBEY}`,
      `Turn this work into the final report for your owner. Keep every concrete item (names, numbers, links). ${a.report.onlyIfNew && prev?.report ? `Set newSinceLast=false if nothing meaningfully new vs the last run (${prev.report.findings.map((f) => f.title).slice(0, 15).join('; ')}).` : 'newSinceLast=true.'}
WORK:\n${raw.slice(0, 16000)}\nJSON: {"title":"","summary":"3-6 sentences","findings":[{"title":"","detail":"","url":""}],"actions":["what the owner should do next"],"newSinceLast":true}`, { maxTokens: 3500, timeoutMs: 90000 });
    const report: Report = rep ? { title: rep.title || a.name, summary: rep.summary || '', findings: (rep.findings || []).slice(0, 40), actions: rep.actions || [], newSinceLast: rep.newSinceLast !== false } : { title: a.name, summary: raw.slice(0, 2000), findings: [], actions: [], newSinceLast: true };
    const run: Run = { id: randomBytes(4).toString('hex'), agentId: a.id, at: new Date().toISOString(), ms: Date.now() - t0, trigger, steps, report, delivered: [] };
    if (trigger !== 'chat' && (!a.report.onlyIfNew || report.newSinceLast !== false)) run.delivered = await deliver(a, report);
    await saveRun(a, run, 'ok');
    return run;
  } catch (e) {
    const run: Run = { id: randomBytes(4).toString('hex'), agentId: a.id, at: new Date().toISOString(), ms: Date.now() - t0, trigger, steps, report: null, delivered: [], error: (e as Error).message.slice(0, 300) };
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
