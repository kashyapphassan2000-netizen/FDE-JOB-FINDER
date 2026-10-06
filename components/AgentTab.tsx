'use client';
import FeedPanel, { hasFeed } from './FeedPanel';
import { ReachButton, SaveButton } from './ReachButton';
import { SOURCE_ICON, SOURCE_TYPES, sourceType, srcKeys } from '@/lib/sourcetype';
import SourceFilter, { useSourceFilter } from './SourceFilter';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, api, setTrack } from './api';
import FitDrawer, { type FitJob } from './FitDrawer';
import CaptureButton from './CaptureButton';
import ExportButton from './ExportButton';

type Mission = { id: string; title: string; desc: string; queries: string[]; rule?: { label: string; kinds: Find['kind'][] } | null };
type Find = {
  id: string; kind: 'job' | 'post' | 'careers_page' | 'company'; title: string; company: string; location: string; url: string; snippet: string; why: string;
  role: string[]; domain: string; locTags: string[]; mission: string; missions?: string[]; fits?: string[]; engine: string; foundAt: string; status: 'new' | 'saved' | 'dismissed' | 'applied';
  ats?: { ats: string; slug: string; total: number; relevant: number }; author?: string; postedAt?: string | null; applyHow?: string; confidence?: 'high' | 'maybe';
};
type Run = { id: string; mission: string; prompt?: string; depth?: string; startedAt: string; ms: number; queries: string[]; engines: string[]; ai: string | null; log: string[]; finds: number; total?: number; companies: number; searches?: number; findIds?: string[]; error?: string };
type Usage = { limit: number; used: number; usedToday: number; dailyBudget: number; engines: { id: string; label: string; used: number; freeMonthly: number }[] };
type Payload = { missions: Mission[]; runs: Run[]; finds: Find[]; engines: string[]; ai: boolean; usage: Usage; xLinks: { label: string; url: string }[]; boardLinks: { group: string; label: string; url: string }[] };

const KIND: Record<Find['kind'], [string, string]> = { post: ['📣', 'Hiring post'], job: ['💼', 'Job'], careers_page: ['🏢', 'Careers page'], company: ['🔎', 'New company board'] };
const EXAMPLES = [
  'Forward deployed engineer roles at Bengaluru AI startups that raised money this year',
  'Remote AI engineer jobs open to candidates in India, LLM / agents, posted this week',
  'AI/ML roles at semiconductor or edge-AI companies in Bengaluru',
  'US startups hiring forward deployed engineers fully remote, worldwide',
];

export default function AgentTab({ toast, onOutreach, missionId }: { toast: (s: string) => void; onOutreach?: (company: string, role: string) => void; missionId?: string }) {
  const [d, setD] = useState<Payload | null>(null);
  const [prompt, setPrompt] = useState('');
  const [depth, setDepth] = useState<'deep' | 'quick'>('deep');
  const [busy, setBusy] = useState('');
  const [secs, setSecs] = useState(0);
  const [progress, setProgress] = useState('');
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [view, setView] = useState<'run' | 'all'>(missionId ? 'all' : 'run');
  const [kind, setKind] = useState('');
  const [stype, setStype] = useState('');
  const [status, setStatus] = useState('open');
  const [mission, setMission] = useState(missionId || '');
  const [fit, setFit] = useState<FitJob | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  // freshness window (hours; 0 = any). Default: last 24 h, latest first.
  // LinkedIn & X: always STRICT 24 h (proven date). Other results: window you pick (default 24 h).
  const [age, setAgeState] = useState(24);
  useEffect(() => { try { const v = localStorage.getItem('fj_agent_age'); if (v !== null && Number(v) >= 0) setAgeState(Number(v)); } catch {} }, []);
  const setAge = (v: number) => { setAgeState(v); try { localStorage.setItem('fj_agent_age', String(v)); } catch {} };
  const liX = (u: string) => /\/\/(?:[a-z]+\.)?(?:x|twitter|linkedin)\.com\//i.test(u);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => api<Payload>('/api/agent').then((p) => { setD(p); setLastRun((r) => r || (missionId ? p.runs.find((x) => x.mission === missionId) : p.runs[0]) || null); }).catch((e) => toast(e.message)), [toast, missionId]);
  useEffect(() => { setMission(missionId || ''); setView(missionId ? 'all' : 'run'); setLastRun(null); setKind(''); }, [missionId]);
  useEffect(() => { load(); }, [load]);

  async function run(body: { missionId?: string; prompt?: string }) {
    setBusy(body.missionId || 'custom');
    if (body.prompt && body.missionId) setView('run');
    setSecs(0);
    timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    toast(depth === 'deep' ? 'Deep search running: many queries on every engine, checking career boards and company pages (2–4 min)…' : 'Quick search running (≈40 s)…');
    try {
      const st = await api<{ id: string }>('/api/agent', { method: 'POST', body: JSON.stringify({ ...body, depth }) });
      // the search runs in the background on the server (no 504); poll for it
      let r: Run | null = null;
      for (let i = 0; i < 120 && !r; i++) {
        await new Promise((ok) => setTimeout(ok, i < 5 ? 3000 : 5000));
        const p = await api<{ done: boolean; run?: Run; log?: string[]; lost?: boolean }>(`/api/agent?run=${st.id}`).catch(() => null);
        if (p?.done && p.run) r = p.run;
        else if (p?.log?.length) setProgress(p.log[p.log.length - 1]);
        else if (p?.lost && i > 70) throw new Error('The search stopped on the server (time limit). Try Quick depth or a narrower search.');
      }
      if (!r) throw new Error('Still running after 10 min — results will appear in the list when it finishes.');
      setProgress('');
      toast(r.error ? `Agent: ${r.error}` : `Done in ${(r.ms / 1000).toFixed(0)}s · ${r.total ?? r.finds} relevant (${r.finds} new) · ${r.searches ?? '?'} searches`);
      setLastRun(r);
      setView('run');
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy('');
      setProgress('');
    }
  }
  async function setStat(f: Find, s: Find['status'] | 'delete') {
    await api('/api/agent', { method: 'PATCH', body: JSON.stringify({ id: f.id, status: s }) });
    if (s === 'saved' || s === 'applied') await setTrack({ id: f.id, title: f.title, company: f.company, location: f.location, url: f.url, sources: [`agent:${f.mission}`], categories: f.role as any, postedAt: f.postedAt || f.foundAt }, s);
    load();
  }
  async function watch(f: Find) {
    if (!f.ats) return;
    await api('/api/companies/watch', { method: 'POST', body: JSON.stringify({ ats: f.ats.ats, slug: f.ats.slug, name: f.company || f.ats.slug }) });
    await setStat(f, 'saved');
    toast(`Watching ${f.company || f.ats.slug} — its jobs arrive in the Jobs tab on the next refresh`);
  }

  async function del(body: Record<string, string | undefined>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    try {
      const r = await api<{ removed?: number }>('/api/agent', { method: 'DELETE', body: JSON.stringify(body) });
      toast(`Deleted${r.removed !== undefined ? ` ${r.removed}` : ''}`);
      if (body.what === 'runs' || (body.what === 'run' && body.id === lastRun?.id)) setLastRun(null);
      await load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function fresh(body: { missionId?: string; prompt?: string }) {
    await api('/api/agent', { method: 'DELETE', body: JSON.stringify({ what: 'cache' }) }).catch(() => null);
    await run(body);
  }

  const byId = useMemo(() => new Map((d?.finds || []).map((f) => [f.id, f])), [d]);
  const runFinds = useMemo(() => (lastRun?.findIds || []).map((id) => byId.get(id)).filter(Boolean) as Find[], [lastRun, byId]);
  const inMission = (f: Find, m: string) => (f.fits ? f.fits.includes(m) : f.mission === m || Boolean(f.missions?.includes(m)));
  const when = (f: Find) => Date.parse(f.postedAt || '') || Date.parse(f.foundAt);
  // on a tab page (X, LinkedIn, Hidden Bengaluru…) ONLY that tab's results are shown and exported
  const scoped = useMemo(() => (view === 'run' ? runFinds : d?.finds || []).filter((f) => !mission || inMission(f, mission)), [view, runFinds, d, mission]);
  const freshFinds = useMemo(() => scoped.filter((f) => {
    if (f.status === 'saved' || f.status === 'applied') return true;
    if (liX(f.url)) return Boolean(f.postedAt) && Date.now() - Date.parse(f.postedAt!) <= 168 * 36e5; // X / LinkedIn posts: proven post date, last 7 days, newest first
    return !age || Date.now() - when(f) < age * 36e5;
  }), [scoped, age]);
  const pool = freshFinds;
  const finds0 = useMemo(
    () => pool
      .filter((f) => (!kind || f.kind === kind) && (!stype || sourceType(f.url) === stype) && (view === 'run' || status === 'all' || (status === 'open' ? f.status === 'new' : f.status === status)))
      .sort((a, b) => when(b) - when(a) || (a.confidence === 'maybe' ? 1 : 0) - (b.confidence === 'maybe' ? 1 : 0)),
    [pool, kind, stype, status, view],
  );
  const sf = useSourceFilter(finds0, (f) => srcKeys(f.url));
  const finds = sf.visible;
  const olderHidden = scoped.length - freshFinds.length;
  const AGE_LABEL: Record<number, string> = { 24: 'last 24 h', 72: 'last 3 days', 168: 'last 7 days', 720: 'last 30 days', 0: 'any time' };
  const counts = useMemo(() => pool.reduce<Record<string, number>>((c, f) => ((c[f.kind] = (c[f.kind] || 0) + 1), c), {}), [pool]);

  if (!d) return <div className="panel muted">Loading agent…</div>;
  const u = d.usage;
  const cur = missionId ? d.missions.find((m) => m.id === missionId) : undefined;
  const runs = cur ? d.runs.filter((r) => r.mission === cur.id) : d.runs;
  const linkGroups = d.boardLinks.reduce<Record<string, { label: string; url: string }[]>>((g, l) => ((g[l.group] ||= []).push(l), g), {});

  return (
    <>
      {!d.engines.length && <div className="notice err">The agent needs at least one web-search key. Go to <b>AI &amp; Keys</b> → add a free <b>Tavily</b> key (1,000 searches/month, no card).</div>}
      {!d.ai && <div className="notice warn">No AI provider yet — the agent falls back to keyword filtering. Add a free <b>Gemini</b> or <b>Groq</b> key in <b>AI &amp; Keys</b>.</div>}

      {cur && (
        <div className="hero">
          <div>
            <h2>{cur.title}</h2>
            <p>{cur.desc}</p>
            {cur.rule && <div className="small" style={{ color: 'var(--mint)', marginTop: 6, fontWeight: 600 }}>🔒 This tab searches and shows only: {cur.rule.label}</div>}
            <textarea className="prompt tabprompt" placeholder={`Ask in plain English — searched only inside “${cur.title}”. e.g. ${cur.id === 'blr-hidden' ? '“seed-stage voice-AI startups in Bengaluru hiring FDEs”' : '“LLM / agent roles posted this week”'}`} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="row" style={{ marginTop: 10 }}>
              {prompt.trim() && <button className="primary" disabled={!!busy} onClick={() => run({ missionId: cur.id, prompt })}>{busy === cur.id ? `Searching… ${secs}s` : '🔎 Search my request'}</button>}
              <button className={prompt.trim() ? '' : 'primary'} disabled={!!busy} onClick={() => run({ missionId: cur.id })}>{busy === cur.id && !prompt.trim() ? `Searching… ${secs}s` : depth === 'deep' ? 'Full sweep of this tab' : 'Quick sweep'}</button>
              <button disabled={!!busy} onClick={() => fresh({ missionId: cur.id })} title="Ignore cached search results and fetch everything new">♻ Fresh results</button>
              <span className="seg"><button className={depth === 'deep' ? 'on' : ''} onClick={() => setDepth('deep')}>Deep</button><button className={depth === 'quick' ? 'on' : ''} onClick={() => setDepth('quick')}>Quick</button></span>
            </div>
            {busy && progress && <div className="small muted" style={{ marginTop: 6 }}>⏳ {progress}</div>}
          </div>
          <div className="hero-stats">
            <div><b>{d.finds.filter((f) => f.mission === cur.id).length}</b><span>saved finds</span></div>
            <div><b>{d.runs.find((r) => r.mission === cur.id) ? ago(d.runs.find((r) => r.mission === cur.id)!.startedAt) : '—'}</b><span>last run</span></div>
          </div>
        </div>
      )}
      {cur && hasFeed(cur.id) && <FeedPanel missionId={cur.id} toast={toast} />}
      {!cur && <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Ask the agent</h3>
          <span className="small muted" title={u.engines.map((e) => `${e.label}: ${e.used}/${e.freeMonthly}`).join('\n')}>
            Engines: <b>{d.engines.join(', ') || 'none'}</b> · searches this month {u.used}/{u.limit} · today {u.usedToday} (auto budget {u.dailyBudget}/day)
          </span>
        </div>
        <textarea className="prompt" placeholder="Describe exactly what you want, e.g. “Bengaluru AI startups hiring FDEs, remote or Bengaluru, this week”" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!!busy || !prompt.trim()} onClick={() => run({ prompt })}>{busy === 'custom' ? `Searching… ${secs}s` : depth === 'deep' ? '🔎 Deep search' : 'Quick search'}</button>
          <span className="seg">
            <button className={depth === 'deep' ? 'on' : ''} onClick={() => setDepth('deep')}>Deep (2–4 min)</button>
            <button className={depth === 'quick' ? 'on' : ''} onClick={() => setDepth('quick')}>Quick (≈40 s)</button>
          </span>
          <button disabled={!!busy || !prompt.trim()} onClick={() => fresh({ prompt })} title="Ignore cached search results">♻ Fresh</button>
          {busy && <span className="small muted">Running: planning → searching every engine → reading posts → checking boards → AI filtering{depth === 'deep' ? ' → follow-up round' : ''}…</span>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {EXAMPLES.map((x) => <span key={x} className="chip" onClick={() => setPrompt(x)}>{x}</span>)}
        </div>
        {u.engines.length === 1 && <div className="hint">Only one search engine is set, so deep mode can't cross-check engines. Free extra engines (AI &amp; Keys): <b>Serper</b> (2,500 Google searches — best for X and LinkedIn posts), <b>Exa</b>, <b>Linkup</b>, <b>Firecrawl</b>. Each one finds different posts.</div>}
      </div>

      <div className="missions">
        {d.missions.map((m) => {
          const last = d.runs.find((r) => r.mission === m.id);
          return (
            <div key={m.id} className={`mission ${m.id.includes('posts') ? 'hot' : ''}`}>
              <div className="mission-title">{m.title}</div>
              <div className="small muted clamp">{m.desc}</div>
              <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                <button className={m.id.includes('posts') ? 'primary small-btn' : 'small-btn'} disabled={!!busy} onClick={() => run({ missionId: m.id })}>{busy === m.id ? `Running… ${secs}s` : 'Run'}</button>
                <span className="small muted">{last ? `${ago(last.startedAt)} · ${last.total ?? last.finds} found` : 'never run'}</span>
              </div>
            </div>
          );
        })}
      </div>
      </>}

      {!cur && <CaptureButton compact />}
      {!cur && <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Optional: open sites yourself (only if you want to — results already come into the app)</h3>
          <button className="small-btn" onClick={() => setShowLinks(!showLinks)}>{showLinks ? 'Hide' : `Show ${d.xLinks.length + d.boardLinks.length} links`}</button>
        </div>
        {showLinks && (
          <div style={{ marginTop: 10 }}>
            {<>
            <div className="small muted" style={{ marginBottom: 6 }}>X advanced search (formulas from your Excel, Latest tab, last 7 days) — open, scroll, then 📥 Capture:</div>
            <div className="row">{d.xLinks.map((l) => <a key={l.url} className="pill link-pill" href={l.url} target="_blank" rel="noreferrer">𝕏 {l.label}</a>)}</div>
            </>}
            {Object.entries(linkGroups).map(([g, ls]) => (
              <div key={g} style={{ marginTop: 10 }}>
                <div className="small muted" style={{ marginBottom: 4 }}>{g}</div>
                <div className="row">{ls.map((l) => <a key={l.url} className="pill link-pill" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>
              </div>
            ))}
          </div>
        )}
      </div>}

      <div className="row results-bar">
        <span className="seg">
          <button className={view === 'run' ? 'on' : ''} onClick={() => setView('run')}>Latest run {lastRun ? `(${runFinds.length})` : ''}</button>
          <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>All saved finds ({cur ? d.finds.filter((f) => f.mission === cur.id).length : d.finds.length})</button>
        </span>
        <span className="seg">
          <button className={!kind ? 'on' : ''} onClick={() => setKind('')}>All</button>
          {(['post', 'job', 'company', 'careers_page'] as const).filter((k) => !cur?.rule || cur.rule.kinds.includes(k)).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND[k][0]} {KIND[k][1]}s · {counts[k] || 0}</button>)}
        </span>
        <select value={stype} onChange={(e) => setStype(e.target.value)} title="Where it came from">
          <option value="">Every source</option>{SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_ICON[t]} {t} · {pool.filter((f) => sourceType(f.url) === t).length}</option>)}
        </select>
        <select value={age} onChange={(e) => setAge(Number(e.target.value))} title="Window for results that are NOT from LinkedIn / X">
          {[24, 72, 168, 720, 0].map((h) => <option key={h} value={h}>Other results: {AGE_LABEL[h]}</option>)}
        </select>
        <span className="badge b-date" title="LinkedIn and X results are shown only when their posting date is proven (from the link or the post text) and within the last 24 hours">⏱ LinkedIn & X: last 24 h only</span>
        <ExportButton title={`${cur ? cur.title : mission ? d.missions.find((m) => m.id === mission)?.title || 'AI Agent' : 'AI Agent'} — ${view === 'run' ? 'latest run' : 'saved finds'} · ${AGE_LABEL[age]}`} filename={`${cur?.id || mission || 'agent'}-${AGE_LABEL[age]}`}
          subtitle={`${cur ? `Only this tab (${cur.title}). ` : ''}Posted ${AGE_LABEL[age]}, newest first. ${lastRun?.prompt ? `Request: ${lastRun.prompt}` : cur?.desc || ''}`}
          cols={[
            { header: 'Type', get: (f: Find) => KIND[f.kind][1], width: 60 },
            { header: 'Role / post', get: (f: Find) => f.title, width: 170, link: (f: Find) => f.url },
            { header: 'Company / author', get: (f: Find) => [f.company, f.author].filter(Boolean).join(' · '), width: 120 },
            { header: 'Location', get: (f: Find) => f.location || 'not stated', width: 80 },
            { header: 'Posted', get: (f: Find) => (f.postedAt ? f.postedAt.slice(0, 10) : `unknown (found ${f.foundAt.slice(0, 10)})`), width: 60 },
            { header: 'How to apply', get: (f: Find) => f.applyHow || '', width: 90 },
            { header: 'Post text / details', get: (f: Find) => f.snippet.slice(0, 380) },
            { header: 'Link', get: (f: Find) => f.url, width: 110, link: (f: Find) => f.url },
          ]} rows={finds} />
        <button className="small-btn danger" onClick={() => del({ what: 'finds', mission: mission || undefined, status: view === 'all' && status !== 'open' && status !== 'all' ? status : undefined }, `Delete ${mission ? 'this mission’s' : 'ALL'} saved finds${view === 'all' && status !== 'open' && status !== 'all' ? ` with status “${status}”` : ''}? (Your Tracker is not touched.)`)}>🗑 Clear {mission ? 'these' : 'all'} finds</button>
        <button className="small-btn" onClick={() => del({ what: 'finds', mission: mission || undefined, status: 'dismissed' }, 'Delete dismissed finds?')}>Clear dismissed</button>
        {view === 'all' && (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">New (untriaged)</option><option value="saved">Saved</option><option value="applied">Applied</option><option value="dismissed">Dismissed</option><option value="all">All</option>
            </select>
            {!cur && <select value={mission} onChange={(e) => setMission(e.target.value)}>
              <option value="">All missions</option><option value="custom">Your prompts</option>{d.missions.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>}
          </>
        )}
      </div>
      {view === 'run' && lastRun && (
        <div className="small muted" style={{ margin: '0 0 10px' }}>
          {lastRun.prompt ? `“${lastRun.prompt.slice(0, 120)}”` : d.missions.find((m) => m.id === lastRun.mission)?.title} · {ago(lastRun.startedAt)} · {(lastRun.ms / 1000).toFixed(0)}s · {lastRun.queries.length} queries · {lastRun.searches ?? '?'} searches · {lastRun.total ?? lastRun.finds} relevant ({lastRun.finds} new){lastRun.error ? ` · ERROR ${lastRun.error}` : ''}
        </div>
      )}
      {view === 'run' && lastRun && !lastRun.findIds && <div className="empty">This run is from before the upgrade. Run a mission or a search to see its results here.</div>}

      <SourceFilter counts={sf.counts} hidden={sf.hidden} setHidden={sf.setHidden} />
      <div className="finds">
        {finds.slice(0, 400).map((f) => <FindCard key={f.id} f={f} onStat={setStat} onWatch={watch} onFit={() => setFit({ id: f.id, title: f.title, company: f.company, location: f.location, url: f.url, description: f.snippet })} onOutreach={onOutreach} toast={toast} />)}
        {olderHidden > 0 && <div className="small muted" style={{ margin: '4px 0 8px' }}>{olderHidden} result{olderHidden > 1 ? 's' : ''} hidden (LinkedIn / X older than 24 h or with no provable date, or others outside “{AGE_LABEL[age]}”).</div>}
        {!finds.length && (view === 'all' || lastRun?.findIds) && <div className="empty">Nothing here{kind ? ' for this type' : ''}. {view === 'run' ? 'Try “All saved finds”, a Deep search, or a different mission.' : ''}</div>}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <h3 style={{ margin: 0 }}>Run logs</h3>
        {runs.length > 0 && <button className="small-btn danger" onClick={() => del({ what: 'runs' }, 'Delete ALL run logs? (Saved finds stay.)')}>🗑 Clear all logs</button>}
      </div>
      {!runs.length && <div className="empty small">No runs yet.</div>}
      {runs.map((r) => (
        <div key={r.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span><b>{r.prompt ? `“${r.prompt.slice(0, 80)}”` : d.missions.find((m) => m.id === r.mission)?.title || r.mission}</b> <span className="small muted">{ago(r.startedAt)} · {r.depth || 'quick'} · {(r.ms / 1000).toFixed(0)}s · {r.total ?? r.finds} relevant · {r.finds} new · {r.searches ?? '?'} searches {r.ai ? `· ${r.ai}` : ''}</span></span>
            <span className="row">
              {r.findIds && <button className="small-btn" onClick={() => { setLastRun(r); setView('run'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Results</button>}
              <button className="small-btn" onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>{openRun === r.id ? 'Hide' : 'Log'}</button>
              <button className="small-btn danger" title="Delete this log" onClick={() => del({ what: 'run', id: r.id }, 'Delete this run log?')}>🗑</button>
            </span>
          </div>
          {r.error && <div className="small" style={{ color: 'var(--err)' }}>{r.error}</div>}
          {openRun === r.id && <div className="log">{['Queries:', ...r.queries.map((q) => `  • ${q}`), '', ...r.log].join('\n')}</div>}
        </div>
      ))}
      {fit && <FitDrawer job={fit} onClose={() => setFit(null)} />}
    </>
  );
}

function FindCard({ f, onStat, onWatch, onFit, onOutreach, toast }: { f: Find; onStat: (f: Find, s: Find['status']) => void; onWatch: (f: Find) => void; onFit: () => void; onOutreach?: (company: string, role: string) => void; toast: (s: string) => void }) {
  const [more, setMore] = useState(false);
  const isPost = f.kind === 'post';
  const where = f.locTags?.includes('BLR') ? ['b-blr', 'Bengaluru'] : f.locTags?.includes('REMOTE_IN') ? ['b-ok', 'Remote · India OK'] : f.location ? ['b-skip', f.location.slice(0, 40)] : ['b-skip', 'location not stated'];
  const host = (() => { try { return new URL(f.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  return (
    <div className={`find ${isPost ? 'post' : ''} ${f.status !== 'new' ? 'triaged' : ''}`}>
      <div className="find-head">
        <span className={`kind k-${f.kind}`}>{KIND[f.kind][0]} {KIND[f.kind][1]}</span>
        {f.confidence === 'maybe' && <span className="badge b-warn" title="Could be relevant — details missing">maybe</span>}
        {f.status !== 'new' && <span className="badge b-ok">{f.status}</span>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>{f.postedAt ? `posted ${ago(f.postedAt)} ago · ${new Date(f.postedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : `post date unknown · found ${ago(f.foundAt)} ago`} · {host}</span>
      </div>
      <a className="find-title" href={f.url} target="_blank" rel="noreferrer noopener">{f.title}</a>
      <div className="job-sub">
        {f.company && <b>{f.company}</b>}
        {isPost && f.author && <span>· by {f.author}</span>}
        <span className={`badge ${where[0]}`}>{where[1]}</span>
        {f.role.map((r) => <span key={r} className={`badge b-${r}`}>{r === 'AIML' ? 'AI/ML' : r}</span>)}
        {f.ats && <span className="badge b-AIML">{f.ats.ats}: {f.ats.relevant} for you / {f.ats.total} open</span>}
      </div>
      {f.snippet && (
        <div className={`find-text ${more ? 'open' : ''}`} onClick={() => setMore(!more)}>{f.snippet}</div>
      )}
      {(f.applyHow || f.why) && (
        <div className="small" style={{ marginTop: 4 }}>
          {f.applyHow && <span className="apply-how">➜ {f.applyHow}</span>} {f.why && <span className="muted">{f.why}</span>}
        </div>
      )}
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <a className="btn primary small-btn" href={f.url} target="_blank" rel="noreferrer noopener">{isPost ? 'Open post' : f.kind === 'job' ? 'Apply' : 'Open'}</a>
        {f.kind === 'company' && f.ats ? <button className="small-btn" onClick={() => onWatch(f)}>👁 Watch board</button> : <button className="small-btn" onClick={onFit}>✨ Fit</button>}
        {onOutreach && (f.company || f.author) && <button className="small-btn" onClick={() => onOutreach(f.company || (f.author || '').replace(/\s*\(@.*$/, ''), f.title)}>✉ People</button>}
        {f.kind !== 'company' && <ReachButton item={{ title: f.title, company: f.company, url: f.url, text: f.snippet, location: f.location, author: f.author }} toast={toast} />}
        <SaveButton item={{ title: f.title, company: f.company, url: f.url, text: `${f.snippet || ''}${f.applyHow ? `\nHow to apply: ${f.applyHow}` : ''}`, location: f.location, author: f.author }} toast={toast} folder={isPost ? 'Saved posts' : 'Saved jobs'} label="🔖 Notepad" />
        <button className="small-btn" onClick={() => onStat(f, 'saved')}>Save</button>
        <button className="small-btn" onClick={() => onStat(f, 'applied')}>Applied</button>
        <button className="small-btn danger" onClick={() => onStat(f, 'dismissed')}>Dismiss</button>
      </div>
    </div>
  );
}
