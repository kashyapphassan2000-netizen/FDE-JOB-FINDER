'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api, setTrack } from './api';
import FitDrawer, { type FitJob } from './FitDrawer';

type Mission = { id: string; title: string; desc: string; queries: string[] };
type Find = {
  id: string; kind: 'job' | 'post' | 'careers_page' | 'company'; title: string; company: string; location: string; url: string; snippet: string; why: string;
  role: string[]; domain: string; locTags: string[]; mission: string; engine: string; foundAt: string; status: 'new' | 'saved' | 'dismissed' | 'applied';
  ats?: { ats: string; slug: string; total: number; relevant: number };
};
type Run = { id: string; mission: string; prompt?: string; startedAt: string; ms: number; queries: string[]; engines: string[]; ai: string | null; log: string[]; finds: number; companies: number; error?: string };
type Payload = { missions: Mission[]; runs: Run[]; finds: Find[]; engines: string[]; ai: boolean };

const KIND: Record<Find['kind'], string> = { job: '💼 Job', post: '📣 Hiring post', careers_page: '🏢 Careers page', company: '🔎 New company board' };
const EXAMPLES = [
  'Forward deployed engineer roles at Bengaluru AI startups that raised money this year',
  'Remote AI engineer jobs open to candidates in India, LLM / agents, posted this week',
  'AI/ML roles at semiconductor or edge-AI companies in Bengaluru (NVIDIA, Qualcomm, startups)',
  'LinkedIn posts from founders hiring forward deployed engineers in India',
  'US startups hiring forward deployed engineers fully remote, worldwide',
];

export default function AgentTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('open');
  const [mission, setMission] = useState('');
  const [fit, setFit] = useState<FitJob | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const load = useCallback(() => api<Payload>('/api/agent').then(setD).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  async function run(body: { missionId?: string; prompt?: string }) {
    setBusy(body.missionId || 'custom');
    toast('Agent running — searching the web, verifying career boards, reading pages (1–4 min)…');
    try {
      const r = await api<Run>('/api/agent', { method: 'POST', body: JSON.stringify(body) });
      toast(r.error ? `Agent: ${r.error}` : `Agent done in ${(r.ms / 1000).toFixed(0)}s · ${r.finds} new finds · ${r.companies} new company boards`);
      setOpenRun(r.id);
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function setStat(f: Find, s: Find['status'] | 'delete') {
    await api('/api/agent', { method: 'PATCH', body: JSON.stringify({ id: f.id, status: s }) });
    if (s === 'saved' || s === 'applied') await setTrack({ id: f.id, title: f.title, company: f.company, location: f.location, url: f.url, sources: [`agent:${f.mission}`], categories: f.role as any, postedAt: f.foundAt }, s);
    load();
  }
  async function watch(f: Find) {
    if (!f.ats) return;
    await api('/api/companies/watch', { method: 'POST', body: JSON.stringify({ ats: f.ats.ats, slug: f.ats.slug, name: f.company || f.ats.slug }) });
    await setStat(f, 'saved');
    toast(`Watching ${f.ats.slug} — its jobs arrive in the Jobs tab on the next refresh`);
  }

  const finds = useMemo(() => (d?.finds || []).filter((f) => (!kind || f.kind === kind) && (!mission || f.mission === mission) && (status === 'all' || (status === 'open' ? f.status === 'new' : f.status === status))), [d, kind, status, mission]);

  if (!d) return <div className="panel muted">Loading agent…</div>;
  return (
    <>
      {!d.engines.length && <div className="notice err">The agent needs at least one web-search key. Go to <b>AI &amp; Keys</b> → add a free <b>Tavily</b> key (1,000 searches/month, no card) — 2 minutes.</div>}
      {!d.ai && <div className="notice warn">No AI provider yet — the agent still works with keyword filtering. Add a free <b>Gemini</b> or <b>Groq</b> key in <b>AI &amp; Keys</b> for smart filtering, career-page reading and fit checks.</div>}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Ask the agent</h3>
        <textarea className="prompt" placeholder="e.g. FDE roles at Bengaluru robotics startups funded in 2026" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="row" style={{ marginTop: 6 }}>
          <button className="primary" disabled={!!busy || !prompt.trim()} onClick={() => run({ prompt })}>{busy === 'custom' ? 'Searching…' : 'Run agent'}</button>
          <span className="small muted">Engines: {d.engines.join(', ') || 'none'} · AI: {d.ai ? 'on' : 'off'}</span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {EXAMPLES.map((x) => <span key={x} className="chip" onClick={() => setPrompt(x)}>{x}</span>)}
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 14 }}>
        {d.missions.map((m) => {
          const last = d.runs.find((r) => r.mission === m.id);
          return (
            <div key={m.id} className="card">
              <h4>{m.title}</h4>
              <div className="small muted">{m.desc}</div>
              <div className="row" style={{ marginTop: 6 }}>
                <button disabled={!!busy} onClick={() => run({ missionId: m.id })}>{busy === m.id ? 'Running…' : 'Run'}</button>
                <span className="small muted">{last ? `last ${ago(last.startedAt)} ago · ${last.finds} new` : 'never run'} · auto every ~3h via cron</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel row">
        <b>Finds ({finds.length})</b>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">New (untriaged)</option><option value="saved">Saved</option><option value="applied">Applied</option><option value="dismissed">Dismissed</option><option value="all">All</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={mission} onChange={(e) => setMission(e.target.value)}>
          <option value="">All missions</option><option value="custom">Your prompts</option>{d.missions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </div>

      <div className="tablewrap">
        <table>
          <thead><tr><th>What</th><th>Found</th><th className="hide-sm">Why</th><th>Action</th></tr></thead>
          <tbody>
            {finds.slice(0, 300).map((f) => (
              <tr key={f.id}>
                <td className="title">
                  <span className="badge b-skip">{KIND[f.kind]}</span> <a href={f.url} target="_blank" rel="noreferrer noopener">{f.title}</a>
                  <div className="small">{f.company} {f.location && <span className="muted">· {f.location}</span>}</div>
                  <div>
                    {f.role.map((r) => <span key={r} className={`badge b-${r}`}>{r === 'AIML' ? 'AI/ML' : r}</span>)}
                    {f.domain && <span className="badge b-dom">{f.domain}</span>}
                    {f.locTags.includes('REMOTE_IN') && <span className="badge b-ok">remote · India OK</span>}
                    {f.ats && <span className="badge b-AIML">{f.ats.ats}: {f.ats.relevant} FDE/AI of {f.ats.total}</span>}
                  </div>
                  {f.snippet && <div className="small muted" style={{ maxWidth: 640 }}>{f.snippet.slice(0, 220)}</div>}
                </td>
                <td className="small">{ago(f.foundAt)} ago<div className="muted">{f.engine}</div></td>
                <td className="hide-sm small" style={{ maxWidth: 260 }}>{f.why}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <a href={f.url} target="_blank" rel="noreferrer noopener"><button className="primary small-btn">{f.kind === 'job' ? 'Apply' : 'Open'}</button></a>
                    {f.kind === 'company' && f.ats ? <button className="small-btn" onClick={() => watch(f)}>Watch</button> : <button className="small-btn" onClick={() => setFit({ id: f.id, title: f.title, company: f.company, location: f.location, url: f.url, description: f.snippet })}>AI</button>}
                    <button className="small-btn" onClick={() => setStat(f, 'saved')}>Save</button>
                    <button className="small-btn" onClick={() => setStat(f, 'applied')}>Applied</button>
                    <button className="small-btn danger" onClick={() => setStat(f, 'dismissed')}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Recent agent runs</h3>
      {d.runs.map((r) => (
        <div key={r.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span><b>{r.prompt ? `“${r.prompt.slice(0, 80)}”` : d.missions.find((m) => m.id === r.mission)?.title || r.mission}</b> <span className="small muted">{ago(r.startedAt)} ago · {(r.ms / 1000).toFixed(0)}s · {r.finds} new · {r.companies} boards {r.ai ? `· ${r.ai}` : ''}</span></span>
            <button className="small-btn" onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>{openRun === r.id ? 'Hide' : 'Log'}</button>
          </div>
          {r.error && <div className="small" style={{ color: 'var(--err)' }}>{r.error}</div>}
          {openRun === r.id && <div className="log">{['Queries:', ...r.queries.map((q) => `  • ${q}`), '', ...r.log].join('\n')}</div>}
        </div>
      ))}
      {fit && <FitDrawer job={fit} onClose={() => setFit(null)} />}
    </>
  );
}
