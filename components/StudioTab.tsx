'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type ToolId = string;
type ModelRef = { profileId: string; model: string; strict: boolean };
type Member = { name: string; role: string; instructions: string; tools: ToolId[]; skills: string[]; model: ModelRef };
type Supervisor = { enabled: boolean; maxRounds: number; passScore: number; criteria: string; model: ModelRef };
type Agent = {
  id?: string; name: string; emoji: string; type: string; goal: string; rules: string; tools: ToolId[]; skills: string[]; canCall: string[]; members: Member[];
  thinking: { depth: string; style: string }; model: ModelRef; supervisor: Supervisor;
  schedule: string; dailyHour: number; report: { email: string; whatsapp: boolean; webhook: string; onlyIfNew: boolean }; maxSteps: number; enabled: boolean; lastRun?: string; lastStatus?: string;
};
type Skill = { id?: string; name: string; description: string; kind: 'prompt' | 'api'; instructions: string; tools: ToolId[]; api?: { method: 'GET' | 'POST'; url: string; headers: string; body: string }; headersPlain?: string };
type ModelOpt = { id: string; label: string; model: string; preset: string; local: boolean };
type Review = { round: number; score: number; verdict: 'pass' | 'fail'; asked: string; done: string; gaps: string[]; fix: string };
const NO_MODEL: ModelRef = { profileId: '', model: '', strict: false };
const BLANK_SKILL: Skill = { name: '', description: '', kind: 'prompt', instructions: '', tools: [], api: { method: 'GET', url: '', headers: '', body: '' } };
type Step = { who: string; thought: string; tool?: string; args?: unknown; observation?: string; at: number };
type Report = { title: string; summary: string; findings: { title: string; detail: string; url?: string }[]; actions: string[]; newSinceLast?: boolean };
type Run = { id: string; at: string; ms: number; trigger: string; steps: Step[]; report: Report | null; delivered: string[]; error?: string; reviews?: Review[]; approved?: boolean; models?: string[] };
type ChatMsg = { role: 'user' | 'agent'; text: string; at: string };

const SCHEDULES: [string, string][] = [['manual', 'Only when I run it'], ['hourly', 'Every hour (24×7)'], ['2h', 'Every 2 hours'], ['6h', 'Every 6 hours'], ['12h', 'Every 12 hours'], ['daily', 'Daily'], ['weekly', 'Weekly']];
type ModeInfo = { label: string; desc: string; members: boolean };
const BLANK: Agent = { name: '', emoji: '🤖', type: 'autonomous', goal: '', rules: '', tools: ['web_search', 'read_page', 'news'], skills: [], canCall: [], members: [], thinking: { depth: 'deep', style: '' }, model: NO_MODEL, supervisor: { enabled: true, maxRounds: 2, passScore: 8, criteria: '', model: NO_MODEL }, schedule: 'manual', dailyHour: 8, report: { email: '', whatsapp: false, webhook: '', onlyIfNew: false }, maxSteps: 8, enabled: true };
const TEMPLATES: (Partial<Agent> & { label: string; blurb: string })[] = [
  { label: 'FDE job hunter', blurb: 'Every 6 h: new FDE / AI roles in Bengaluru or remote-India across every company board, LinkedIn and X — with apply links.', emoji: '🎯', type: 'monitor', schedule: '6h', tools: ['company_jobs', 'web_search', 'read_page', 'my_jobs', 'memory'], report: { email: 'me', whatsapp: true, webhook: '', onlyIfNew: true },
    goal: 'Find NEW Forward Deployed Engineer and AI/ML engineer roles posted in the last 24 hours that I can take: Bengaluru office, or remote open to India. Search all company boards (company_jobs), then LinkedIn posts (site:linkedin.com/posts) and X posts (site:x.com) for hiring posts. Open the promising ones and capture role, company, location, experience asked, salary if stated and EVERY way to apply. Remember what you already reported (memory) and only report new ones.',
    rules: 'Never report onsite roles outside Bengaluru. Never report US/EU-only remote roles. Newest first. Always include the apply link.' },
  { label: 'Layoff & risk radar', blurb: 'Daily: who is cutting jobs, why, and whether it touches me or companies I applied to.', emoji: '📉', type: 'monitor', schedule: 'daily', tools: ['news', 'market', 'web_search', 'memory'], report: { email: 'me', whatsapp: false, webhook: '', onlyIfNew: true },
    goal: 'Track layoffs, hiring freezes and restructurings in tech and AI (India first, then global) from the last 48 hours. For each: company, how many, reason, teams hit, what they do next. Tell me bluntly what it means for an FDE / AI engineer job seeker in Bengaluru.', rules: 'Only events from the last 48 hours. Cite the source link for every item.' },
  { label: 'Research team', blurb: 'A multi-agent team: researcher, analyst, critic and writer for any deep question.', emoji: '👥', type: 'team', schedule: 'manual', tools: ['web_search', 'read_page', 'news'],
    goal: 'Answer the research question I give you with a deep, sourced, decision-ready report.', rules: 'Cite every claim. Separate facts from judgement. End with a clear recommendation.',
    members: [{ name: 'Researcher', role: 'finds and reads primary sources', instructions: 'Search widely, open the best 4-6 pages, extract facts with links.', tools: ['web_search', 'read_page', 'news'], skills: [], model: NO_MODEL }, { name: 'Analyst', role: 'numbers, comparisons, market view', instructions: 'Compare options with numbers; use market data.', tools: ['web_search', 'market'], skills: [], model: NO_MODEL }, { name: 'Contrarian', role: 'finds risks and counter-evidence', instructions: 'Look for what could go wrong and evidence against the obvious answer.', tools: ['web_search', 'news'], skills: [], model: NO_MODEL }] },
  { label: 'Decision debate', blurb: 'Two agents argue for and against (offer A vs B, learn X vs Y, switch job or not); a judge decides on evidence.', emoji: '⚖', type: 'debate', schedule: 'manual', tools: ['web_search', 'read_page', 'news', 'market'], thinking: { depth: 'elite', style: '' },
    goal: 'Decide the question I give you. Use real data (salaries, market demand, company health) and give a clear verdict for me — an FDE / AI engineer in Bengaluru.', rules: 'Evidence over opinion. Cite links. Give one clear decision at the end.' },
  { label: 'Elite planner', blurb: 'Plan & execute with Elite thinking and a strict supervisor — for big multi-step jobs.', emoji: '🗺', type: 'plan_execute', schedule: 'manual', tools: ['web_search', 'read_page', 'news', 'company_jobs', 'my_cv', 'market'], thinking: { depth: 'elite', style: '' },
    goal: 'Do the multi-step job I give you completely, step by step, with evidence.', rules: 'No step skipped. Every claim with a source.' },
  { label: 'Company tracker', blurb: 'Every 12 h: news, funding, leadership changes and new FDE/AI roles at companies you name.', emoji: '🏢', type: 'monitor', schedule: '12h', tools: ['news', 'web_search', 'company_jobs', 'read_page', 'memory'], report: { email: 'me', whatsapp: false, webhook: '', onlyIfNew: true },
    goal: 'Track these companies: Sarvam AI, Databricks, Glean, Cursor, Anthropic (edit this list). For each: news from the last 24 h (funding, launches, leadership, layoffs) and any new FDE / AI roles. Tell me who to reach out to and why now.', rules: 'Only new items since the last report. Include links.' },
  { label: 'Daily learning coach', blurb: 'Every morning: the one thing to learn today, why, where and how — from the market and my CV.', emoji: '📚', type: 'autonomous', schedule: 'daily', tools: ['market', 'my_cv', 'web_search', 'excel'], report: { email: 'me', whatsapp: true, webhook: '', onlyIfNew: false },
    goal: 'Look at today\'s AI market (hot skills, new roles) and my CV. Pick the single most valuable thing for me to learn today (60-90 min), why it matters for FDE / AI roles right now, the best FREE resource, and a tiny hands-on exercise. Be strict like a coach.', rules: 'One topic only. Free resources first. No fluff.' },
  { label: 'Blank custom agent', blurb: 'Start from scratch — any instruction, any tools, any schedule.', emoji: '✳️', type: 'autonomous', schedule: 'manual', goal: '' },
];

function Md({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}</a> : <Fragment key={i}>{p}</Fragment>));
  return <div className="md">{text.split('\n').map((l, i) => { const t = l.trim(); if (!t) return null; if (/^[-*•]\s/.test(t)) return <div key={i} className="md-li">• {inline(t.replace(/^[-*•]\s/, ''))}</div>; return <p key={i}>{inline(t)}</p>; })}</div>;
}

export default function StudioTab({ toast }: { toast: (s: string) => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Record<string, { label: string; desc: string }>>({});
  const [modes, setModes] = useState<Record<string, ModeInfo>>({});
  const [depths, setDepths] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skill, setSkill] = useState<Skill>(BLANK_SKILL);
  const [hosted, setHosted] = useState(true);
  const [channels, setChannels] = useState<{ whatsapp: boolean; canEmailAnyone: boolean; email: boolean } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<'gallery' | 'edit' | 'view' | 'skills' | 'local' | null>(null);
  const [draft, setDraft] = useState<Agent>(BLANK);
  const [tab, setTab] = useState<'chat' | 'runs' | 'settings'>('chat');
  const [runs, setRuns] = useState<Run[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState('');
  const [secs, setSecs] = useState(0);
  const [openRun, setOpenRun] = useState<string | null>(null);
  useEffect(() => { if (!busy) return; setSecs(0); const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t); }, [busy]);

  const load = useCallback(() => api<{ agents: Agent[]; skills: Skill[]; tools: Record<string, { label: string; desc: string }>; modes: Record<string, ModeInfo>; depths: Record<string, string>; models: ModelOpt[]; hosted: boolean; channels: { whatsapp: boolean; canEmailAnyone: boolean; email: boolean } }>('/api/studio').then((d) => { setAgents(d.agents); setSkills(d.skills); setTools(d.tools); setModes(d.modes); setDepths(d.depths); setModels(d.models); setHosted(d.hosted); setChannels(d.channels); if (!d.agents.length) setMode((m) => m || 'gallery'); }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  const open = useCallback(async (id: string) => {
    setSel(id); setMode('view'); setOpenRun(null);
    const d = await api<{ agent: Agent; runs: Run[]; chat: ChatMsg[] }>(`/api/studio?id=${id}`);
    setDraft(d.agent); setRuns(d.runs); setChat(d.chat);
  }, []);

  async function save() {
    setBusy('save');
    try { const r = await api<{ agent: Agent }>('/api/studio', { method: 'POST', body: JSON.stringify({ action: 'save', agent: draft }) }); toast(`Saved “${r.agent.name}”${r.agent.schedule !== 'manual' ? ' — it now runs on its own' : ''}`); await load(); await open(r.agent.id!); setTab(draft.id ? 'settings' : 'chat'); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function run() {
    if (!sel) return;
    setBusy('run');
    try { const r = await api<{ run: Run }>('/api/studio', { method: 'POST', body: JSON.stringify({ action: 'run', id: sel, task: task || undefined }) }); toast(r.run.error ? `Failed: ${r.run.error}` : `Done: ${r.run.report?.title}`); setTask(''); await open(sel); setTab('runs'); setOpenRun(r.run.id); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function send() {
    if (!sel || !text.trim()) return;
    const t = text; setText(''); setChat((c) => [...c, { role: 'user', text: t, at: new Date().toISOString() }]); setBusy('chat');
    try { await api('/api/studio', { method: 'POST', body: JSON.stringify({ action: 'chat', id: sel, text: t }) }); await open(sel); setTab('chat'); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function saveSkill() {
    setBusy('skill');
    try { await api('/api/studio', { method: 'POST', body: JSON.stringify({ action: 'skill_save', skill }) }); toast(`Skill “${skill.name}” saved — attach it to any agent`); setSkill(BLANK_SKILL); await load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function delSkill(id: string) { if (!confirm('Delete this skill? Agents using it lose it.')) return; await api('/api/studio', { method: 'POST', body: JSON.stringify({ action: 'skill_delete', id }) }); load(); }
  async function del() { if (!sel || !confirm(`Delete agent “${draft.name}”?`)) return; await api('/api/studio', { method: 'POST', body: JSON.stringify({ action: 'delete', id: sel }) }); setSel(null); setMode(null); load(); }
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleTool = (t: string, list: string[]) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);
  const runSections = (r: Run) => [{ title: r.report?.title || 'Run', text: r.report?.summary || r.error || '' }, { title: 'Findings', headers: ['Item', 'Detail', 'Link'], rows: (r.report?.findings || []).map((f) => [f.title, f.detail, f.url || '']) }, { title: 'Do next', text: (r.report?.actions || []).map((x) => `• ${x}`).join('\n') }, { title: 'How the agent worked', headers: ['Who', 'Thought', 'Tool', 'Result (short)'], rows: r.steps.map((s) => [s.who, s.thought, s.tool || '', (s.observation || '').slice(0, 300)]) }];

  const modelPick = (v: ModelRef, on: (m: ModelRef) => void, inherit = 'Auto — best available, rotates on limits') => (
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <select value={v.profileId} onChange={(e) => on({ ...v, profileId: e.target.value, model: '' })}>
        <option value="">{inherit}</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.local ? '💻 ' : ''}{m.label}{m.model ? ` · ${m.model}` : ''}</option>)}
      </select>
      {v.profileId && <input className="mono" style={{ width: 170 }} placeholder="exact model (optional)" value={v.model} onChange={(e) => on({ ...v, model: e.target.value })} />}
      {v.profileId && <label className="small" title="Never fall back to another provider — e.g. keep data on your local LLM"><input type="checkbox" checked={v.strict} onChange={(e) => on({ ...v, strict: e.target.checked })} /> only this model</label>}
    </span>
  );
  const skillChips = (sel: string[], on: (x: string[]) => void) => (
    <div className="st-tools">{skills.length ? skills.map((k) => <label key={k.id} className={`st-tool sm ${sel.includes(k.id!) ? 'on' : ''}`} title={k.description}><input type="checkbox" checked={sel.includes(k.id!)} onChange={() => on(toggleTool(k.id!, sel))} />{k.kind === 'api' ? '🔌 ' : '🧩 '}{k.name}</label>) : <span className="small muted">No skills yet — <a href="#" onClick={(e) => { e.preventDefault(); setMode('skills'); }}>create one</a>.</span>}</div>
  );
  const isTeam = modes[draft.type]?.members;

  const editor = (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>{draft.id ? `Edit ${draft.emoji} ${draft.name}` : 'Create an agent'}</h3>{!draft.id && <button className="small-btn" onClick={() => setMode('gallery')}>← templates</button>}</div>
      <label className="st-label">Agentic mode — how it works</label>
      <div className="st-types">{Object.entries(modes).map(([t, m]) => <div key={t} className={`st-type ${draft.type === t ? 'on' : ''}`} onClick={() => set('type', t)}><b>{m.label}</b><span>{m.desc}</span></div>)}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <input style={{ width: 64, textAlign: 'center', fontSize: 20 }} value={draft.emoji} onChange={(e) => set('emoji', e.target.value)} />
        <input className="grow big" placeholder="Agent name — e.g. My FDE job hunter" value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <label className="st-label">Instructions — tell it exactly what to do (it follows your orders directly)</label>
      <textarea className="st-area" rows={6} placeholder="e.g. Every 6 hours find new FDE roles in Bengaluru posted in the last 24 h on company boards, LinkedIn and X. Report role, company, experience, salary, apply link…" value={draft.goal} onChange={(e) => set('goal', e.target.value)} />
      <label className="st-label">Rules it must never break (optional)</label>
      <textarea className="st-area" rows={3} placeholder="e.g. Only Bengaluru or remote-India. Always include the source link. Never repeat something already reported." value={draft.rules} onChange={(e) => set('rules', e.target.value)} />
      <label className="st-label">Tools it can use</label>
      <div className="st-tools">{Object.entries(tools).map(([id, t]) => <label key={id} className={`st-tool ${draft.tools.includes(id) ? 'on' : ''}`} title={t.desc}><input type="checkbox" checked={draft.tools.includes(id)} onChange={() => set('tools', toggleTool(id, draft.tools))} />{t.label}</label>)}</div>
      <label className="st-label">🧩 Skills (your own know-how / custom API tools)</label>
      {skillChips(draft.skills, (x) => set('skills', x))}
      <div className="st-box">
        <label className="st-label" style={{ marginTop: 0 }}>🧠 Brain — model &amp; thinking</label>
        <div className="small">Model: {modelPick(draft.model, (m) => set('model', m))}</div>
        <div className="row" style={{ marginTop: 6 }}>
          <label className="small">Thinking <select value={draft.thinking.depth} onChange={(e) => set('thinking', { ...draft.thinking, depth: e.target.value })}>{Object.entries(depths).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="small">Max steps <select value={draft.maxSteps} onChange={(e) => set('maxSteps', Number(e.target.value))}>{[4, 6, 8, 10, 12, 14, 16, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
        <textarea className="st-area" rows={2} placeholder="Design how it thinks (optional) — e.g. “Think like a hiring manager at a top AI startup. Always check salary vs market. Prefer primary sources. Doubt anything older than 7 days.”" value={draft.thinking.style} onChange={(e) => set('thinking', { ...draft.thinking, style: e.target.value })} />
        {!models.length && <div className="small muted">Add models in Setup → AI &amp; Keys (cloud APIs, or Ollama / LM Studio when running locally) — then map them here.</div>}
      </div>
      <div className="st-box">
        <label className="small"><input type="checkbox" checked={draft.supervisor.enabled} onChange={(e) => set('supervisor', { ...draft.supervisor, enabled: e.target.checked })} /> <b>🕵 Supervisor</b> — an independent reviewer compares what you asked with what the agent did, scores it brutally and sends it back with exact fixes until it passes</label>
        {draft.supervisor.enabled && (
          <>
            <div className="row" style={{ marginTop: 6 }}>
              <label className="small">Pass at ≥ <select value={draft.supervisor.passScore} onChange={(e) => set('supervisor', { ...draft.supervisor, passScore: Number(e.target.value) })}>{[6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}/10</option>)}</select></label>
              <label className="small">Max rounds <select value={draft.supervisor.maxRounds} onChange={(e) => set('supervisor', { ...draft.supervisor, maxRounds: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </div>
            <div className="small" style={{ marginTop: 6 }}>Supervisor model: {modelPick(draft.supervisor.model, (m) => set('supervisor', { ...draft.supervisor, model: m }), 'Same as agent')}</div>
            <textarea className="st-area" rows={2} placeholder="Your pass criteria (optional) — e.g. “Every job must have an apply link and a date within 24 h. At least 5 items.”" value={draft.supervisor.criteria} onChange={(e) => set('supervisor', { ...draft.supervisor, criteria: e.target.value })} />
          </>
        )}
      </div>
      {agents.filter((x) => x.id !== draft.id).length > 0 && (
        <>
          <label className="st-label">🤝 Can call these agents (multi-agent collaboration — it delegates sub-tasks to them)</label>
          <div className="st-tools">{agents.filter((x) => x.id !== draft.id).map((x) => <label key={x.id} className={`st-tool sm ${draft.canCall.includes(x.id!) ? 'on' : ''}`}><input type="checkbox" checked={draft.canCall.includes(x.id!)} onChange={() => set('canCall', toggleTool(x.id!, draft.canCall))} />{x.emoji} {x.name}</label>)}</div>
        </>
      )}
      {isTeam && (
        <>
          <label className="st-label">Members (each isolated: own role, instructions, tools, skills and model)</label>
          {draft.members.map((m, i) => (
            <div key={i} className="st-member">
              <div className="row"><input placeholder="Name" value={m.name} onChange={(e) => set('members', draft.members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /><input className="grow" placeholder="Role — e.g. finds primary sources" value={m.role} onChange={(e) => set('members', draft.members.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} /><button className="small-btn danger" onClick={() => set('members', draft.members.filter((_, j) => j !== i))}>✕</button></div>
              <textarea className="st-area" rows={2} placeholder="This member's own instructions" value={m.instructions} onChange={(e) => set('members', draft.members.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)))} />
              <div className="st-tools">{Object.entries(tools).map(([id, t]) => <label key={id} className={`st-tool sm ${m.tools.includes(id) ? 'on' : ''}`}><input type="checkbox" checked={m.tools.includes(id)} onChange={() => set('members', draft.members.map((x, j) => (j === i ? { ...x, tools: toggleTool(id, x.tools) } : x)))} />{t.label}</label>)}</div>
              {skills.length > 0 && skillChips(m.skills || [], (v) => set('members', draft.members.map((x, j) => (j === i ? { ...x, skills: v } : x))))}
              <div className="small">Model: {modelPick(m.model || NO_MODEL, (v) => set('members', draft.members.map((x, j) => (j === i ? { ...x, model: v } : x))), 'Same as agent')}</div>
            </div>
          ))}
          <button className="small-btn" onClick={() => set('members', [...draft.members, { name: `Member ${draft.members.length + 1}`, role: '', instructions: '', tools: draft.tools, skills: [], model: NO_MODEL }])}>＋ Add member</button>
        </>
      )}
      <div className="grid2" style={{ marginTop: 12 }}>
        <div>
          <label className="st-label">When does it run?</label>
          <div className="row"><select value={draft.schedule} onChange={(e) => set('schedule', e.target.value)}>{SCHEDULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {(draft.schedule === 'daily' || draft.schedule === 'weekly') && <label className="small">at <select value={draft.dailyHour} onChange={(e) => set('dailyHour', Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 IST</option>)}</select></label>}</div>
          <label className="small" style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Active (scheduled runs on)</label>
        </div>
        <div>
          <label className="st-label">Report to</label>
          <div className="small">✅ This page (always)</div>
          <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={draft.report.email === 'me'} onChange={(e) => set('report', { ...draft.report, email: e.target.checked ? 'me' : '' })} /> Email me</label>
          <input style={{ width: '100%', margin: '4px 0' }} placeholder="…or email to another address" value={draft.report.email === 'me' ? '' : draft.report.email} onChange={(e) => set('report', { ...draft.report, email: e.target.value })} />
          <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={draft.report.whatsapp} onChange={(e) => set('report', { ...draft.report, whatsapp: e.target.checked })} /> WhatsApp me {channels && !channels.whatsapp && <span className="muted">(connect in Settings first)</span>}</label>
          <input style={{ width: '100%', margin: '4px 0' }} placeholder="Webhook URL (Slack / Discord / Zapier / n8n) — optional" value={draft.report.webhook} onChange={(e) => set('report', { ...draft.report, webhook: e.target.value })} />
          <label className="small" style={{ display: 'block' }}><input type="checkbox" checked={draft.report.onlyIfNew} onChange={(e) => set('report', { ...draft.report, onlyIfNew: e.target.checked })} /> Only report when something is new</label>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="primary" disabled={busy === 'save' || !draft.goal.trim()} onClick={save}>{draft.id ? 'Save changes' : '✨ Create agent'}</button>{draft.id && <button className="danger" onClick={del}>Delete agent</button>}</div>
    </div>
  );

  return (
    <>
      <div className="hero">
        <div>
          <h2>Agent studio — build your own AI agents</h2>
          <p>Press ＋ and build any agent: 10 agentic modes (ReAct, plan &amp; execute, reflexion, tree of thought, team, pipeline, debate, swarm, router, 24×7 monitor), your own skills, your own thinking design, any model per agent and per member — cloud or your local LLM — and a brutally honest supervisor that checks what was asked against what was done. Every agent is isolated, follows your orders directly, has its own chat and memory, and reports to this page, email, WhatsApp or any webhook. Results export to PDF.</p>
        </div>
        <div className="hero-stats"><div><b>{agents.length}</b><span>agents</span></div><div><b>{agents.filter((a) => a.enabled && a.schedule !== 'manual').length}</b><span>running 24×7</span></div></div>
      </div>
      {channels && !channels.canEmailAnyone && <div className="notice warn small">Emails to <b>your own</b> address work. To email reports to other addresses add a Gmail app password or a free Brevo key (AI &amp; Keys → Access).</div>}
      <div className="st-layout">
        <aside className="st-list">
          <button className="st-plus" onClick={() => { setDraft(BLANK); setSel(null); setMode('gallery'); }}>＋ <span>New agent</span></button>
          <div className="row" style={{ gap: 6, margin: '0 0 8px' }}><button className={`small-btn grow ${mode === 'skills' ? 'primary' : ''}`} onClick={() => { setSel(null); setMode('skills'); }}>🧩 Skills ({skills.length})</button><button className={`small-btn grow ${mode === 'local' ? 'primary' : ''}`} onClick={() => { setSel(null); setMode('local'); }}>💻 Local LLM</button></div>
          {agents.map((a) => (
            <button key={a.id} className={`st-item ${sel === a.id ? 'on' : ''}`} onClick={() => open(a.id!)}>
              <span className="st-emoji">{a.emoji}</span>
              <span className="st-meta"><b>{a.name}</b> <small>{(modes[a.type]?.label || a.type).replace(/^\S+\s/, '')} · {SCHEDULES.find(([v]) => v === a.schedule)?.[1]}{!a.enabled ? ' · paused' : ''}</small><small>{a.lastRun ? `ran ${ago(a.lastRun)} ago · ${a.lastStatus?.startsWith('failed') ? '⚠ failed' : 'ok'}` : 'not run yet'}</small></span>
            </button>
          ))}
        </aside>
        <section className="st-main">
          {mode === 'gallery' && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>What should your new agent do?</h3>
              <div className="st-gallery">{TEMPLATES.map((t) => <div key={t.label} className="st-tpl" onClick={() => { setDraft({ ...BLANK, ...t, report: { ...BLANK.report, ...(t.report || {}) }, thinking: { ...BLANK.thinking, ...(t.thinking || {}) }, members: t.members || [] } as Agent); setMode('edit'); }}><span className="st-emoji big">{t.emoji}</span><b>{t.label}</b><span className="small muted">{t.blurb}</span></div>)}</div>
            </div>
          )}
          {mode === 'edit' && editor}
          {mode === 'skills' && (
            <>
              <div className="panel">
                <h3 style={{ marginTop: 0 }}>{skill.id ? `Edit skill: ${skill.name}` : '＋ New skill'}</h3>
                <p className="small muted">A skill is reusable know-how you write once and attach to any agent or member. <b>🧩 Know-how</b> = instructions, playbooks, checklists, templates, your style. <b>🔌 API tool</b> = the agent can call your own API / n8n / Zapier / script endpoint as a tool.</p>
                <div className="seg" style={{ marginBottom: 8 }}>{(['prompt', 'api'] as const).map((k) => <button key={k} className={skill.kind === k ? 'on' : ''} onClick={() => setSkill({ ...skill, kind: k })}>{k === 'prompt' ? '🧩 Know-how' : '🔌 API tool'}</button>)}</div>
                <div className="row"><input className="grow" placeholder="Skill name — e.g. Cold email writer" value={skill.name} onChange={(e) => setSkill({ ...skill, name: e.target.value })} /></div>
                <input style={{ width: '100%', marginTop: 6 }} placeholder="One line: what it does / when to use it" value={skill.description} onChange={(e) => setSkill({ ...skill, description: e.target.value })} />
                <textarea className="st-area" rows={skill.kind === 'prompt' ? 8 : 3} placeholder={skill.kind === 'prompt' ? 'The know-how. e.g.\n1. Cold emails are max 90 words.\n2. First line = something specific about their product.\n3. One proof point from my CV with a number.\n4. Ask for a 15-min call, never a job.' : 'How the agent should use this API (optional)'} value={skill.instructions} onChange={(e) => setSkill({ ...skill, instructions: e.target.value })} />
                {skill.kind === 'api' && (
                  <div className="grid2">
                    <label className="small">Method <select value={skill.api?.method || 'GET'} onChange={(e) => setSkill({ ...skill, api: { ...(skill.api || BLANK_SKILL.api!), method: e.target.value as 'GET' } })}><option>GET</option><option>POST</option></select></label>
                    <label className="small">URL — put <code>{'{input}'}</code> where the agent’s input goes<input className="mono" style={{ width: '100%' }} placeholder="https://api.example.com/search?q={input}" value={skill.api?.url || ''} onChange={(e) => setSkill({ ...skill, api: { ...(skill.api || BLANK_SKILL.api!), url: e.target.value } })} /></label>
                    <label className="small">Headers JSON (encrypted, hidden after save)<input className="mono" style={{ width: '100%' }} type="password" placeholder={skill.api?.headers ? '(saved — type to replace)' : '{"Authorization":"Bearer …"}'} value={skill.headersPlain || ''} onChange={(e) => setSkill({ ...skill, headersPlain: e.target.value })} /></label>
                    {skill.api?.method === 'POST' && <label className="small">Body (JSON, use {'{input}'})<input className="mono" style={{ width: '100%' }} placeholder='{"query":"{input}"}' value={skill.api?.body || ''} onChange={(e) => setSkill({ ...skill, api: { ...(skill.api || BLANK_SKILL.api!), body: e.target.value } })} /></label>}
                  </div>
                )}
                <label className="st-label">Tools this skill needs (added to any agent that uses it)</label>
                <div className="st-tools">{Object.entries(tools).filter(([id]) => id !== 'ask_agent').map(([id, t]) => <label key={id} className={`st-tool sm ${skill.tools.includes(id) ? 'on' : ''}`}><input type="checkbox" checked={skill.tools.includes(id)} onChange={() => setSkill({ ...skill, tools: toggleTool(id, skill.tools) })} />{t.label}</label>)}</div>
                <div className="row" style={{ marginTop: 10 }}><button className="primary" disabled={busy === 'skill' || !skill.name.trim()} onClick={saveSkill}>{skill.id ? 'Save skill' : '＋ Create skill'}</button>{skill.id && <button onClick={() => setSkill(BLANK_SKILL)}>Cancel</button>}</div>
              </div>
              {skills.map((k) => (
                <div key={k.id} className="panel row" style={{ justifyContent: 'space-between' }}>
                  <div className="grow"><b>{k.kind === 'api' ? '🔌' : '🧩'} {k.name}</b><div className="small muted">{k.description || k.instructions.slice(0, 140)}</div><div className="small muted">Used by: {agents.filter((a) => a.skills.includes(k.id!) || a.members.some((m) => (m.skills || []).includes(k.id!))).map((a) => a.name).join(', ') || 'no agent yet'}</div></div>
                  <button className="small-btn" onClick={() => setSkill({ ...k, headersPlain: '' })}>Edit</button><button className="small-btn danger" onClick={() => delSkill(k.id!)}>✕</button>
                </div>
              ))}
            </>
          )}
          {mode === 'local' && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>💻 Run on localhost with your own local LLM</h3>
              <p className="small">{hosted ? <>You are on the <b>cloud</b> version. The cloud server <b>cannot reach localhost on your PC</b> — so for local models run the app on your machine (5 minutes):</> : <>You are running <b>locally</b> ✅ — local LLMs work directly.</>}</p>
              <ol className="small" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
                <li>Install <a href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js 20+</a> and <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama</a> (or LM Studio).</li>
                <li>Pull a model: <code>ollama pull qwen2.5:14b</code> (16 GB RAM) or <code>ollama pull llama3.1:8b</code> (8 GB). Good tool-users: qwen2.5 / qwen3, llama3.1, mistral-nemo, gpt-oss:20b.</li>
                <li><code>git clone</code> the repo → <code>npm install</code></li>
                <li>Create <code>.env.local</code> with <code>APP_PASSWORD=…</code>, <code>AUTH_SECRET=</code>(any 32+ chars), and optionally <code>OLLAMA_BASE_URL=http://localhost:11434/v1</code> + <code>OLLAMA_MODEL=qwen2.5:14b</code>. Copy your Redis vars too if you want the same data as the cloud; without them data is saved in <code>.data/store.json</code> on your PC.</li>
                <li><code>npm run dev</code> → open <code>http://localhost:3000</code></li>
                <li>Setup → AI &amp; Keys → add <b>Ollama (local LLM)</b> (no key) → Load models → Save.</li>
                <li>Here, open an agent → 🧠 Brain → pick the 💻 Ollama model → tick <b>only this model</b> if data must never leave your PC.</li>
              </ol>
              <p className="small muted">While the local app is running, a built-in scheduler runs your scheduled agents every 5 minutes (no Vercel cron needed). Honest limits: small local models (≤8B) follow the JSON tool format less reliably than big cloud models — use 14B+ for agents, or map only simple members to the local model. Alternative without running locally: expose Ollama through an https tunnel (e.g. <code>cloudflared tunnel --url http://localhost:11434</code>) and add it as a custom OpenAI-compatible provider with that URL + <code>/v1</code>.</p>
            </div>
          )}
          {mode === 'view' && sel && (
            <>
              <div className="panel st-head">
                <span className="st-emoji big">{draft.emoji}</span>
                <div className="grow"><h3 style={{ margin: 0 }}>{draft.name}</h3> <div className="small muted">{modes[draft.type]?.label} · {draft.model.profileId ? `🧠 ${models.find((m) => m.id === draft.model.profileId)?.label || 'mapped model'}` : '🧠 auto model'} · {SCHEDULES.find(([v]) => v === draft.schedule)?.[1]} · reports: page{draft.report.email ? ', email' : ''}{draft.report.whatsapp ? ', WhatsApp' : ''}{draft.report.webhook ? ', webhook' : ''}</div></div>
                <span className="seg">{(['chat', 'runs', 'settings'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'chat' ? '💬 Chat' : t === 'runs' ? `📋 Results (${runs.length})` : '⚙ Settings'}</button>)}</span>
              </div>
              {tab === 'settings' && editor}
              {tab === 'chat' && (
                <div className="panel mentor-chat">
                  <div className="mentor-msgs">
                    {!chat.length && <div className="mentor-empty">Talk to <b>{draft.name}</b>. Give it a task or a new order — it uses its tools, reasons it through, and answers. </div>}
                    {chat.map((m, i) => <div key={i} className={`bubble ${m.role === 'user' ? 'user' : 'mentor'}`}>{m.role === 'agent' ? <Md text={m.text} /> : m.text}<span className="bubble-at">{ago(m.at)} ago</span></div>)}
                    {busy === 'chat' && <div className="bubble mentor typing">{draft.emoji} working with its tools… {secs}s</div>}
                  </div>
                  <div className="mentor-input"><textarea rows={2} placeholder={`Order ${draft.name}… (Enter to send)`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} /><button className="primary" disabled={!!busy || !text.trim()} onClick={send}>Send</button></div>
                </div>
              )}
              {tab === 'runs' && (
                <>
                  <div className="panel row">
                    <input className="grow" placeholder="Optional: a specific task for this run (empty = its normal job)" value={task} onChange={(e) => setTask(e.target.value)} />
                    <button className="primary" disabled={!!busy} onClick={run}>{busy === 'run' ? `Running… ${secs}s` : '▶ Run now'}</button>
                  </div>
                  {runs.map((r) => (
                    <div key={r.id} className="panel st-run">
                      <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>
                        <div><b>{r.error ? '⚠ Failed' : r.report?.title}</b><div className="small muted">{r.reviews?.length ? (r.approved ? '✅ supervisor approved · ' : '⚠ supervisor not satisfied · ') : ''}{new Date(r.at).toLocaleString('en-IN')} · {r.trigger} · {Math.round(r.ms / 1000)}s · {r.steps.length} steps · sent to: {r.delivered.join(', ') || '—'}</div></div>
                        <span className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}><ExportButton title={`${draft.emoji} ${draft.name} — ${r.report?.title || 'run'}`} filename={`${draft.name}-${r.at.slice(0, 10)}`} subtitle={new Date(r.at).toLocaleString('en-IN')} sections={runSections(r)} /></span>
                      </div>
                      {openRun === r.id && (
                        <div style={{ marginTop: 10 }}>
                          {r.error && <div className="notice warn small">{r.error}</div>}
                          {r.reviews && r.reviews.length > 0 && <div className={`notice small ${r.approved ? 'ok' : 'warn'}`}><b>🕵 Supervisor: {r.approved ? 'APPROVED' : 'NOT approved'}</b> — {r.reviews.map((v) => `round ${v.round}: ${v.score}/10`).join(' → ')}{r.reviews[r.reviews.length - 1].gaps.length > 0 && <ul style={{ margin: '4px 0 0' }}>{r.reviews[r.reviews.length - 1].gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}</div>}
                          {r.models && r.models.length > 0 && <div className="small muted">Models used: {r.models.join(' · ')}</div>}
                          {r.report && <><p>{r.report.summary}</p>{r.report.findings.map((f, i) => <div key={i} className="tline"><b>{f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.title} ↗</a> : f.title}</b><div className="small">{f.detail}</div></div>)}{r.report.actions.length > 0 && <div className="notice ok small"><b>Do next:</b><ul style={{ margin: '4px 0 0' }}>{r.report.actions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}</>}
                          <details className="small"><summary>How it reasoned ({r.steps.length} steps)</summary>{r.steps.map((s, i) => <div key={i} className="st-step"><b>{s.who}</b>{s.tool && <span className="badge b-dom">{s.tool}</span>}<div>{s.thought}</div>{s.observation && <pre>{s.observation}</pre>}</div>)}</details>
                        </div>
                      )}
                    </div>
                  ))}
                  {!runs.length && <div className="empty">No results yet — click ▶ Run now{draft.schedule !== 'manual' ? ' or wait for its schedule' : ''}.</div>}
                </>
              )}
            </>
          )}
          {!mode && <div className="empty">Pick an agent on the left, or press ＋ to create one.</div>}
        </section>
      </div>
    </>
  );
}
