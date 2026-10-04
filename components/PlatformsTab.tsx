'use client';
import { useEffect, useMemo, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type Platform = { id: string; name: string; url: string; host: string; mapping: string; connectors: string[]; searchTemplate: string; kind: string; sheets: string[]; notes: string };
type Check = { lastChecked?: string; status?: string; notes?: string };
type Eff = { id: string; eff: string; detail: string; connectors: string[] };
type Payload = { platforms: Platform[]; checks: Record<string, Check>; live: Record<string, boolean>; eff: Record<string, Eff> };

const EFF: Record<string, [string, string, string]> = {
  live_ok: ['✅ LIVE — automatic', 'b-ok', 'Pulled into your Jobs / Agent tabs automatically; last run succeeded.'],
  live_failing: ['⚠️ LIVE but failing', 'b-err', 'Connected, but the last attempt failed. Check Sources & APIs.'],
  capture: ['📥 CAPTURE (your browser)', 'b-warn', 'Blocks servers or needs login. Open it logged in → click the 📥 Capture bookmark → every job on the page is imported.'],
  agent: ['🤖 AGENT only (partial)', 'b-AIML', 'No public job feed. Only found when AI-agent web searches hit it. Capture its careers page for full coverage.'],
  action: ['📘 ACTION / to-do', 'b-skip', 'Not a job feed: a tool, program, community or agency to sign up for. Tick “done” when you have.'],
  out_of_rule: ['🚫 Outside your rule', 'b-skip', 'Relocation abroad — you only take Bengaluru office or remote.'],
  excluded: ['⛔ Excluded', 'b-err', 'Defunct or not worth your time.'],
};

export default function PlatformsTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [q, setQ] = useState('');
  const [eff, setEff] = useState('');
  const [kind, setKind] = useState('');
  const [kw, setKw] = useState('forward deployed engineer');
  const [todo, setTodo] = useState(false);

  useEffect(() => { api<Payload>('/api/platforms').then(setD).catch((e) => toast(e.message)); }, [toast]);

  const kinds = useMemo(() => Array.from(new Set((d?.platforms || []).map((p) => p.kind))).sort(), [d]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (d?.platforms || []).forEach((p) => { const e = d!.eff[p.id]?.eff || 'action'; c[e] = (c[e] || 0) + 1; });
    return c;
  }, [d]);
  if (!d) return <div className="panel muted">Checking every Excel entry against what is really running…</div>;

  const list = d.platforms.filter((p) => {
    const e = d.eff[p.id]?.eff;
    if (eff && e !== eff) return false;
    if (kind && p.kind !== kind) return false;
    if (todo) {
      const lc = d.checks[p.id]?.lastChecked;
      if (!['capture', 'agent', 'action'].includes(e || '')) return false;
      if (e === 'action' && d.checks[p.id]?.status === 'done') return false;
      if (e !== 'action' && lc && Date.now() - Date.parse(lc) < 3 * 864e5) return false;
    }
    if (q && !`${p.name} ${p.host} ${p.notes} ${p.sheets.join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a, b) => Object.keys(EFF).indexOf(d.eff[a.id]?.eff) - Object.keys(EFF).indexOf(d.eff[b.id]?.eff));

  const searchUrl = (p: Platform) => (p.searchTemplate || p.url).replace('{q}', encodeURIComponent(kw)).replace('{qslug}', kw.trim().toLowerCase().replace(/\s+/g, '-'));
  async function mark(p: Platform, status: string) {
    try {
      const r = await api<{ check: Check }>('/api/platforms', { method: 'POST', body: JSON.stringify({ id: p.id, status }) });
      setD({ ...d!, checks: { ...d!.checks, [p.id]: r.check } });
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const auto = (counts.live_ok || 0);
  const total = d.platforms.length;

  return (
    <>
      <div className="notice small">
        <b>Brutally honest map of all {total} platforms, companies and channels in your Excel.</b> Status is computed right now from what is actually connected and succeeding — nothing is marked live because it was planned.
        {' '}<b>{auto}</b> are fully automatic. The rest are either reachable only through <b>📥 Capture</b> in your own logged-in browser (no site can block that), only partially through the AI agent, or are to-dos that no software can do for you (signing up, joining communities, certifications).
      </div>
      <div className="stats">
        {Object.entries(EFF).map(([k, [l]]) => (
          <div key={k} className="stat" style={{ cursor: 'pointer', outline: eff === k ? '2px solid var(--brand)' : 'none' }} onClick={() => setEff(eff === k ? '' : k)} title={EFF[k][2]}>
            <b>{counts[k] || 0}</b><span>{l}</span>
          </div>
        ))}
      </div>
      <div className="panel row">
        <input className="grow" placeholder="Search platforms, companies, sheets…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ExportButton title="Excel coverage map" subtitle={`${list.length} items · status is checked at runtime against what is really running`} filename="excel-coverage"
          cols={[{ header: 'Platform / company', get: (p: Platform) => p.name, width: 110, link: (p) => p.url }, { header: 'Kind', get: (p) => p.kind, width: 70 }, { header: 'Status', get: (p) => (EFF[d.eff[p.id]?.eff]?.[0] || d.eff[p.id]?.eff || '').replace(/^\S+\s/, ''), width: 80 },
            { header: 'Detail', get: (p) => d.eff[p.id]?.detail || '' }, { header: 'Sheets', get: (p) => p.sheets.join(', '), width: 110 }]}
          rows={list} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          {kinds.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
        <label className="small">Keyword for links: <input value={kw} onChange={(e) => setKw(e.target.value)} /></label>
        <label className="small"><input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> only my to-dos (capture not done in 3 days, actions not done)</label>
      </div>
      {eff && <div className="hint" style={{ marginBottom: 10 }}>{EFF[eff][2]}</div>}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Platform / company</th><th>Real status</th><th className="hide-sm">Excel sheet(s)</th><th>Last done</th><th>Action</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const e = d.eff[p.id];
              const [label, cls] = EFF[e?.eff] || ['?', 'b-skip'];
              const c = d.checks[p.id];
              return (
                <tr key={p.id}>
                  <td>
                    <a href={p.url} target="_blank" rel="noreferrer noopener"><b>{p.name}</b></a>
                    <div className="small muted">{p.host} · {p.kind.replace(/_/g, ' ')}</div>
                    {p.notes && <div className="small muted clamp" style={{ maxWidth: 520 }}>{p.notes}</div>}
                  </td>
                  <td style={{ maxWidth: 360 }}>
                    <span className={`badge ${cls}`}>{label}</span>
                    <div className="small" style={{ marginTop: 3 }}>{e?.detail}</div>
                  </td>
                  <td className="hide-sm small">{p.sheets.join(', ')}</td>
                  <td className="small">{c?.status === 'done' ? '✓ done' : c?.lastChecked ? `${ago(c.lastChecked)}` : '—'}</td>
                  <td>
                    <div className="row">
                      {e?.eff !== 'excluded' && <a className="btn small-btn" href={searchUrl(p)} target="_blank" rel="noreferrer noopener">Open ↗</a>}
                      {e?.eff === 'action' ? <button className="small-btn" onClick={() => mark(p, 'done')}>✓ done</button> : e?.eff !== 'live_ok' && <button className="small-btn" onClick={() => mark(p, 'checked')}>✓ captured</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
