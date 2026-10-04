'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type DepSignal = { org: string; repo: string; added: string[]; at: string; url: string };
type FormD = { name: string; cik: string; filed: string; link: string; board?: string; roles?: number; aiRoles?: string[]; checkedAt?: string };
type State = { signals: DepSignal[]; uses: Record<string, string[]>; formd: FormD[]; meta: { at: string; scanned: number; techy: number } | null; orgs: string[]; tokenSet: boolean; deps: string[] };

export default function RadarTab({ toast, isOwner, onWatch }: { toast: (s: string) => void; isOwner: boolean; onWatch?: (company: string) => void }) {
  const [d, setD] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [orgs, setOrgs] = useState('');
  const load = useCallback(() => api<State>('/api/radar').then((x) => { setD(x); setOrgs(x.orgs.join(', ')); }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  async function run() {
    setBusy(true);
    try { const r = await api<{ github: { repos?: number; signals?: DepSignal[]; note?: string; error?: string }; formd: { scanned?: number; techy?: number; withAiRoles?: number; error?: string } }>('/api/radar', { method: 'POST', body: JSON.stringify({ action: 'run' }) }); toast(`GitHub: ${r.github.error || `${r.github.repos} repos, ${r.github.signals?.length || 0} new signals${r.github.note ? ` — ${r.github.note}` : ''}`} · SEC: ${r.formd.error || `${r.formd.scanned} filings, ${r.formd.techy} tech raises`}`); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  if (!d) return <div className="panel muted">Loading radar…</div>;
  const usesRows = Object.entries(d.uses).filter(([, v]) => v.length).sort((a, b) => b[1].length - a[1].length);
  return (
    <>
      <div className="hero">
        <div>
          <h2>Zero-day radar — hiring signals before the job is posted</h2>
          <p>Public boards show a role after hundreds have applied. This watches what comes first: AI companies adding serving / infra libraries (vLLM, SGLang, Triton, TensorRT-LLM, Ray…) to their code, and fresh private raises (new SEC Form D filings). A company that just did either usually needs infra / forward-deployed engineers within 30–60 days — reach out now.</p>
        </div>
        <div className="hero-stats"><div><b>{d.signals.length}</b><span>dependency signals</span></div><div><b>{d.formd.length}</b><span>new tech raises</span></div></div>
      </div>
      <div className="panel row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">Runs twice a day automatically{d.meta ? ` · last SEC scan ${ago(d.meta.at)} ago (${d.meta.scanned} filings)` : ''} · GitHub: {d.tokenSet ? 'token set — all orgs every run' : '12 orgs per run (add a free GITHUB_TOKEN for all)'}</span>
        <span className="row" style={{ gap: 6 }}>
          {isOwner && <button className="primary" disabled={busy} onClick={run}>{busy ? 'Scanning…' : '⟳ Scan now'}</button>}
          <ExportButton title="Zero-day radar" sections={[{ title: 'New dependencies (GitHub)', headers: ['When', 'Company', 'Repo', 'Added'], rows: d.signals.map((s) => [s.at.slice(0, 10), s.org, s.repo, s.added.join(', ')]) }, { title: 'New raises (SEC Form D)', headers: ['Filed', 'Company', 'Job board', 'AI / FDE roles'], rows: d.formd.map((f) => [f.filed, f.name, f.board || '—', (f.aiRoles || []).join(' · ')]) }, { title: 'Who runs what', headers: ['Company (GitHub org)', 'Serving / infra stack'], rows: usesRows.map(([o, v]) => [o, v.join(', ')]) }]} />
        </span>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>🧬 Just added to their code</h3>
          {!d.signals.length && <div className="small muted">No changes yet — the first scan records a baseline; any dependency a company adds after that shows up here.</div>}
          {d.signals.map((s, i) => <div key={i} className="tline"><b>{s.org}</b> added <b>{s.added.join(', ')}</b> in <a href={s.url} target="_blank" rel="noreferrer">{s.repo} ↗</a><div className="small muted">{ago(s.at)} ago</div></div>)}
          <h4>Who runs what (latest scan)</h4>
          <div className="tablewrap"><table><thead><tr><th>Company</th><th>Serving / infra stack in their repos</th></tr></thead><tbody>{usesRows.slice(0, 60).map(([o, v]) => <tr key={o}><td><a href={`https://github.com/${o}`} target="_blank" rel="noreferrer">{o}</a></td><td className="small">{v.join(', ')}</td></tr>)}</tbody></table></div>
          {isOwner && <><label className="st-label">GitHub orgs to watch (comma separated)</label><textarea className="st-area" rows={3} value={orgs} onChange={(e) => setOrgs(e.target.value)} /><button className="small-btn" onClick={() => api('/api/radar', { method: 'POST', body: JSON.stringify({ action: 'orgs', orgs: orgs.split(/[,\n]/) }) }).then(() => { toast('Orgs saved'); load(); }).catch((e) => toast(e.message))}>Save orgs</button></>}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>💰 Fresh capital (new SEC Form D raises, US)</h3>
          <p className="small muted">New private raises filed in the last days, filtered to tech-sounding companies (funds / real-estate removed), each checked for a public job board. Form D has no business description, so expect some non-AI companies — check before reaching out. India / Bengaluru raises come from Hidden jobs &amp; startups (funding news).</p>
          {d.formd.map((f) => (
            <div key={f.cik} className="tline">
              <b>{f.name}</b> <span className="small muted">filed {f.filed}</span> <a className="small" href={f.link} target="_blank" rel="noreferrer">filing ↗</a>
              <div className="small">{f.checkedAt ? (f.board ? <>Job board <b>{f.board}</b> — {f.roles} open roles{f.aiRoles?.length ? <>, AI / FDE: {f.aiRoles.join(' · ')}</> : ', none AI / FDE yet → cold outreach window'}</> : 'No public job board yet → cold outreach window') : 'not checked yet'}
                {onWatch && <button className="small-btn" style={{ marginLeft: 6 }} onClick={() => onWatch(f.name)}>👁 Watch</button>}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
