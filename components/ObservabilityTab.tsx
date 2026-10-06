'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type Ev = { id: string; at: string; ns: string; area: string; name: string; status: 'ok' | 'warn' | 'fail'; detail: string; ms?: number; ref?: string };
type Check = { group: string; name: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string; ms?: number };
type Ai = { day: string; provider: string; model: string; ok: number; fail: number; avgMs: number };
const DOT = { ok: '🟢', warn: '🟡', fail: '🔴' } as const;
const AREAS = ['', 'cron', 'source', 'ai', 'email', 'whatsapp', 'agent', 'mcp', 'login', 'alerts', 'semantic', 'radar', 'autopilot'];

export default function ObservabilityTab({ toast, onOpenAgent }: { toast: (s: string) => void; onOpenAgent?: () => void }) {
  const [d, setD] = useState<{ owner: boolean; events: Ev[]; ai: Ai[]; health: { at: string; checks: Check[] } | null } | null>(null);
  const [area, setArea] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api<NonNullable<typeof d>>(`/api/obs?area=${area}&status=${status}`).then(setD).catch((e) => toast(e.message)), [area, status, toast]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  async function act(action: string) {
    setBusy(action);
    try { const r = await api<{ note?: string; checks?: Check[] }>('/api/obs', { method: 'POST', body: JSON.stringify({ action }) }); toast(r.note || (r.checks ? `Checked ${r.checks.length} services — ${r.checks.filter((c) => c.status === 'fail').length} failing, ${r.checks.filter((c) => c.status === 'warn').length} warnings` : 'Done')); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  const evs = useMemo(() => (d?.events || []).filter((e) => !q || `${e.name} ${e.detail} ${e.ns}`.toLowerCase().includes(q.toLowerCase())), [d, q]);
  const aiToday = useMemo(() => { const m = new Map<string, Ai>(); for (const r of d?.ai || []) { const k = `${r.provider}|${r.model}`; const c = m.get(k) || { ...r, ok: 0, fail: 0 }; c.ok += r.ok; c.fail += r.fail; m.set(k, c); } return [...m.values()].sort((a, b) => b.ok + b.fail - a.ok - a.fail); }, [d]);
  if (!d) return <div className="panel muted">Loading…</div>;
  const counts = { ok: evs.filter((e) => e.status === 'ok').length, warn: evs.filter((e) => e.status === 'warn').length, fail: evs.filter((e) => e.status === 'fail').length };
  const groups = d.health ? Array.from(new Set(d.health.checks.map((c) => c.group))) : [];
  return (
    <>
      <div className="hero">
        <div>
          <h2>{d.owner ? 'Observability — everything the app did, live' : 'My activity'}</h2>
          <p>{d.owner ? 'Every scheduled run, job source, AI call, email, WhatsApp, agent run, MCP call and sign-in — with status, timing and the exact error. Run a full service check to see what works, what is broken and exactly how to fix it.' : 'Everything the app did for you: agent runs, emails, sign-ins, AI tools.'}</p>
        </div>
        <div className="hero-stats"><div><b>{counts.ok}</b><span>ok</span></div><div><b>{counts.warn}</b><span>warnings</span></div><div><b>{counts.fail}</b><span>failed</span></div></div>
      </div>
      {d.owner && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>🩺 Service health {d.health && <span className="small muted">— checked {ago(d.health.at)} ago</span>}</h3>
            <span className="row" style={{ gap: 6 }}>
              <button className="primary" disabled={!!busy} onClick={() => act('check')}>{busy === 'check' ? 'Checking every service… (~30-60 s)' : '▶ Run full check'}</button>
              <button disabled={!!busy} onClick={() => act('test-email')}>✉ Test email</button>
              <button disabled={!!busy} onClick={() => act('test-whatsapp')}>💬 Test WhatsApp</button>
              {d.health && <ExportButton title="Service health" sections={[{ title: 'Checks', headers: ['Group', 'Service', 'Status', 'Detail', 'Fix'], rows: d.health.checks.map((c) => [c.group, c.name, c.status, c.detail, c.fix || '']) }]} />}
            </span>
          </div>
          {!d.health && <div className="empty">Click ▶ Run full check.</div>}
          {groups.map((g) => (
            <div key={g}>
              <h4 style={{ margin: '12px 0 6px' }}>{g}</h4>
              {d.health!.checks.filter((c) => c.group === g).map((c) => (
                <div key={c.name} className={`obs-check ${c.status}`}>
                  <div><b>{DOT[c.status]} {c.name}</b> <span className="small muted">{c.detail}</span></div>
                  {c.fix && <div className="small obs-fix">🔧 {c.fix}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {d.owner && aiToday.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>🧠 AI calls — last 7 days</h3>
          <div className="tablewrap"><table><thead><tr><th>Provider</th><th>Model</th><th>OK</th><th>Failed</th><th>Avg latency</th></tr></thead><tbody>{aiToday.map((r) => <tr key={`${r.provider}${r.model}`}><td>{r.provider}</td><td className="mono small">{r.model}</td><td>{r.ok}</td><td>{r.fail ? <b style={{ color: 'var(--bad, #d33)' }}>{r.fail}</b> : 0}</td><td>{r.avgMs} ms</td></tr>)}</tbody></table></div>
        </div>
      )}
      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }} className="grow">📜 Event log</h3>
          <select value={area} onChange={(e) => setArea(e.target.value)}>{AREAS.map((a) => <option key={a} value={a}>{a ? a : 'All areas'}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="ok">ok</option><option value="warn">warnings</option><option value="fail">failed</option></select>
          <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ExportButton title="Event log" sections={[{ title: 'Events', headers: ['When', 'Area', 'Name', 'Status', 'User', 'Detail', 'ms'], rows: evs.map((e) => [e.at.replace('T', ' ').slice(0, 19), e.area, e.name, e.status, e.ns, e.detail, String(e.ms ?? '')]) }]} />
        </div>
        {!evs.length && <div className="empty">No events yet — logging starts with this version; crons, agents, emails and sign-ins appear here as they happen.</div>}
        <div className="obs-list">
          {evs.slice(0, 300).map((e) => (
            <div key={e.id} className={`obs-ev ${e.status}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="obs-when">{ago(e.at)}</span>
              <span className="badge b-dom">{e.area}</span>
              <span>{DOT[e.status]}</span>
              <b className="obs-name">{e.name}</b>
              {d.owner && e.ns !== 'owner' && <span className="badge b-skip">{e.ns}</span>}
              {e.ms !== undefined && <span className="small muted">{e.ms < 1000 ? `${e.ms} ms` : `${(e.ms / 1000).toFixed(1)} s`}</span>}
              <span className="small muted obs-detail">{open === e.id ? '' : e.detail.slice(0, 110)}</span>
              {open === e.id && <div className="obs-open small"><pre>{e.detail}</pre><div className="muted">{new Date(e.at).toLocaleString('en-IN')}</div></div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
