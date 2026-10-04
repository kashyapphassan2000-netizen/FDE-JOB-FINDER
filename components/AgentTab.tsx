'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, api, setTrack } from './api';
import FitDrawer, { type FitJob } from './FitDrawer';
import CaptureButton from './CaptureButton';

type Mission = { id: string; title: string; desc: string; queries: string[] };
type Find = {
  id: string; kind: 'job' | 'post' | 'careers_page' | 'company'; title: string; company: string; location: string; url: string; snippet: string; why: string;
  role: string[]; domain: string; locTags: string[]; mission: string; engine: string; foundAt: string; status: 'new' | 'saved' | 'dismissed' | 'applied';
  ats?: { ats: string; slug: string; total: number; relevant: number }; author?: string; postedAt?: string | null; applyHow?: string; confidence?: 'high' | 'maybe';
};
type Run = { id: string; mission: string; prompt?: string; depth?: string; startedAt: string; ms: number; queries: string[]; engines: string[]; ai: string | null; log: string[]; finds: number; total?: number; companies: number; searches?: number; findIds?: string[]; error?: string };
type Usage = { limit: number; used: number; usedToday: number; dailyBudget: number; engines: { id: string; label: string; used: number; freeMonthly: number }[] };
type Payload = { missions: Mission[]; runs: Run[]; finds: Find[]; engines: string[]; ai: boolean; usage: Usage; xLinks: { label: string; url: string }[]; boardLinks: { group: string; label: string; url: string }[] };

const LINK_GROUPS: Record<string, string[]> = {
  'x-posts': [], 'li-posts': ['LinkedIn'], 'blr-hidden': ['India boards', 'Startup boards'], 'remote-india': ['Remote boards', 'AI-only', 'Gig'],
  'global-remote': ['Remote boards', 'AI-only', 'Startup boards', 'Gig'], domains: ['India boards', 'AI-only'], 'new-startups': ['Startup boards'], communities: ['Communities', 'Newsletters'],
};
const KIND: Record<Find['kind'], [string, string]> = { post: ['📣', 'Hiring post'], job: ['💼', 'Job'], careers_page: ['🏢', 'Careers page'], company: ['🔎', 'New company board'] };
const EXAMPLES = [
  'X / Twitter posts from founders hiring forward deployed or AI engineers, remote or Bengaluru, this week',
  'LinkedIn posts: Bengaluru AI startups hiring GenAI / LLM engineers, DM or email to apply',
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
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [view, setView] = useState<'run' | 'all'>(missionId ? 'all' : 'run');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('open');
  const [mission, setMission] = useState(missionId || '');
  const [fit, setFit] = useState<FitJob | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => api<Payload>('/api/agent').then((p) => { setD(p); setLastRun((r) => r || (missionId ? p.runs.find((x) => x.mission === missionId) : p.runs[0]) || null); }).catch((e) => toast(e.message)), [toast, missionId]);
  useEffect(() => { setMission(missionId || ''); setView(missionId ? 'all' : 'run'); setLastRun(null); }, [missionId]);
  useEffect(() => { load(); }, [load]);

  async function run(body: { missionId?: string; prompt?: string }) {
    setBusy(body.missionId || 'custom');
    setSecs(0);
    timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    toast(depth === 'deep' ? 'Deep search running: many queries on every engine, reading every X post, checking career boards (2–4 min)…' : 'Quick search running (≈40 s)…');
    try {
      const r = await api<Run>('/api/agent', { method: 'POST', body: JSON.stringify({ ...body, depth }) });
      toast(r.error ? `Agent: ${r.error}` : `Done in ${(r.ms / 1000).toFixed(0)}s · ${r.total ?? r.finds} relevant (${r.finds} new) · ${r.searches ?? '?'} searches`);
      setLastRun(r);
      setView('run');
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy('');
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
  const pool = view === 'run' ? runFinds : d?.finds || [];
  const finds = useMemo(
    () => pool
      .filter((f) => (!kind || f.kind === kind) && (view === 'run' || !mission || f.mission === mission) && (view === 'run' || status === 'all' || (status === 'open' ? f.status === 'new' : f.status === status)))
      .sort((a, b) => (a.kind === 'post' ? 0 : 1) - (b.kind === 'post' ? 0 : 1) || (a.confidence === 'maybe' ? 1 : 0) - (b.confidence === 'maybe' ? 1 : 0) || Date.parse(b.postedAt || b.foundAt) - Date.parse(a.postedAt || a.foundAt)),
    [pool, kind, status, mission, view],
  );
  const counts = useMemo(() => pool.reduce<Record<string, number>>((c, f) => ((c[f.kind] = (c[f.kind] || 0) + 1), c), {}), [pool]);

  if (!d) return <div className="panel muted">Loading agent…</div>;
  const u = d.usage;
  const cur = missionId ? d.missions.find((m) => m.id === missionId) : undefined;
  const runs = cur ? d.runs.filter((r) => r.mission === cur.id) : d.runs;
  const showLinksHidden = false;
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
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" disabled={!!busy} onClick={() => run({ missionId: cur.id })}>{busy === cur.id ? `Searching… ${secs}s` : depth === 'deep' ? '🔎 Run deep search' : 'Run quick search'}</button>
              <button disabled={!!busy} onClick={() => fresh({ missionId: cur.id })} title="Ignore cached search results and fetch everything new">♻ Fresh results</button>
              <span className="seg"><button className={depth === 'deep' ? 'on' : ''} onClick={() => setDepth('deep')}>Deep</button><button className={depth === 'quick' ? 'on' : ''} onClick={() => setDepth('quick')}>Quick</button></span>
            </div>
          </div>
          <div className="hero-stats">
            <div><b>{d.finds.filter((f) => f.mission === cur.id).length}</b><span>saved finds</span></div>
            <div><b>{d.runs.find((r) => r.mission === cur.id) ? ago(d.runs.find((r) => r.mission === cur.id)!.startedAt) : '—'}</b><span>last run</span></div>
          </div>
        </div>
      )}
      {!cur && <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Ask the agent</h3>
          <span className="small muted" title={u.engines.map((e) => `${e.label}: ${e.used}/${e.freeMonthly}`).join('\n')}>
            Engines: <b>{d.engines.join(', ') || 'none'}</b> · searches this month {u.used}/{u.limit} · today {u.usedToday} (auto budget {u.dailyBudget}/day)
          </span>
        </div>
        <textarea className="prompt" placeholder="Describe exactly what you want, e.g. “X posts from founders hiring FDEs, remote or Bengaluru, this week”" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
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

      <CaptureButton compact={!cur || !cur.id.includes('posts')} />
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Live searches — open while logged in (real-time, nothing missed)</h3>
          <button className="small-btn" onClick={() => setShowLinks(!showLinks)}>{showLinks || cur ? 'Hide' : `Show ${d.xLinks.length + d.boardLinks.length} links`}</button>
        </div>
        {(showLinks || (cur && !showLinksHidden)) && (
          <div style={{ marginTop: 10 }}>
            {(!cur || cur.id === 'x-posts') && <>
            <div className="small muted" style={{ marginBottom: 6 }}>X advanced search (formulas from your Excel, Latest tab, last 7 days) — open, scroll, then 📥 Capture:</div>
            <div className="row">{d.xLinks.map((l) => <a key={l.url} className="pill link-pill" href={l.url} target="_blank" rel="noreferrer">𝕏 {l.label}</a>)}</div>
            </>}
            {Object.entries(linkGroups).filter(([g]) => !cur || (LINK_GROUPS[cur.id] || []).some((x) => g.includes(x))).map(([g, ls]) => (
              <div key={g} style={{ marginTop: 10 }}>
                <div className="small muted" style={{ marginBottom: 4 }}>{g}</div>
                <div className="row">{ls.map((l) => <a key={l.url} className="pill link-pill" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="row results-bar">
        <span className="seg">
          <button className={view === 'run' ? 'on' : ''} onClick={() => setView('run')}>Latest run {lastRun ? `(${runFinds.length})` : ''}</button>
          <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>All saved finds ({cur ? d.finds.filter((f) => f.mission === cur.id).length : d.finds.length})</button>
        </span>
        <span className="seg">
          <button className={!kind ? 'on' : ''} onClick={() => setKind('')}>All</button>
          {(['post', 'job', 'company', 'careers_page'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND[k][0]} {KIND[k][1]}s · {counts[k] || 0}</button>)}
        </span>
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

      <div className="finds">
        {finds.slice(0, 400).map((f) => <FindCard key={f.id} f={f} onStat={setStat} onWatch={watch} onFit={() => setFit({ id: f.id, title: f.title, company: f.company, location: f.location, url: f.url, description: f.snippet })} onOutreach={onOutreach} />)}
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

function FindCard({ f, onStat, onWatch, onFit, onOutreach }: { f: Find; onStat: (f: Find, s: Find['status']) => void; onWatch: (f: Find) => void; onFit: () => void; onOutreach?: (company: string, role: string) => void }) {
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
        <span className="small muted" style={{ marginLeft: 'auto' }}>{f.postedAt ? `posted ${ago(f.postedAt)}` : `found ${ago(f.foundAt)}`} · {host}</span>
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
        <button className="small-btn" onClick={() => onStat(f, 'saved')}>Save</button>
        <button className="small-btn" onClick={() => onStat(f, 'applied')}>Applied</button>
        <button className="small-btn danger" onClick={() => onStat(f, 'dismissed')}>Dismiss</button>
      </div>
    </div>
  );
}
