'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type Draft = { jobId: string; title: string; company: string; url: string; subject: string; hook: string; proof: string; ask: string; text: string; at: string };
type Report = { at: string; jobs: number; terms: { term: string; pct: number; inCv: boolean; delta: number | null }[]; gaps: { term: string; why: string; how: string }[]; summary: string };

export default function AutopilotPanel({ toast }: { toast: (s: string) => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api<{ drafts: Draft[]; reports: Report[] }>('/api/autopilot').then((d) => { setDrafts(d.drafts); setReports(d.reports); }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  async function act(action: 'gap' | 'drafts') {
    setBusy(action);
    try { const r = await api<{ drafts?: Draft[] }>('/api/autopilot', { method: 'POST', body: JSON.stringify({ action }) }); toast(action === 'gap' ? 'Gap report ready' : `${r.drafts?.length || 0} new drafts (only roles the AI ranked ≥ 85% fit; run 🧠 Rank with AI in Jobs first)`); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  const r = reports[0];
  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>📉 Resume gap telemetry {r && <span className="small muted">— {ago(r.at)} ago, top {r.jobs} roles</span>}</h3>
          <span className="row" style={{ gap: 6 }}>
            <button className="primary" disabled={!!busy} onClick={() => act('gap')}>{busy === 'gap' ? 'Analysing… (~1 min)' : 'Run gap report'}</button>
            {r && <ExportButton title="Resume gap report" subtitle={new Date(r.at).toLocaleString('en-IN')} sections={[{ title: 'Summary', text: r.summary }, { title: 'Close these first', headers: ['Skill', 'Why now', 'Fastest proof'], rows: r.gaps.map((g) => [g.term, g.why, g.how]) }, { title: 'Demand this week', headers: ['Skill', '% of top roles', 'vs last week', 'In my CV'], rows: r.terms.map((t) => [t.term, `${t.pct}%`, t.delta === null ? '' : String(t.delta), t.inCv ? 'yes' : 'MISSING']) }]} />}
          </span>
        </div>
        <p className="small muted">Every Monday: what the week's top-100 AI roles (ranked for you) ask for vs what your CV shows, with the trend vs last week. Emailed to the owner automatically.</p>
        {r ? (
          <>
            {r.summary && <div className="notice warn small">{r.summary}</div>}
            <ol className="small">{r.gaps.map((g) => <li key={g.term}><b>{g.term}</b> — {g.why}<div className="muted">{g.how}</div></li>)}</ol>
            <div className="tablewrap"><table><thead><tr><th>Skill / concept</th><th>% of top roles</th><th>Trend</th><th>Your CV</th></tr></thead><tbody>
              {r.terms.slice(0, 30).map((t) => <tr key={t.term}><td>{t.term}</td><td style={{ minWidth: 120 }}><div className="bar"><i style={{ width: `${t.pct}%` }} /></div><span className="small">{t.pct}%</span></td><td className="small">{t.delta === null ? '—' : t.delta > 0 ? `▲ ${t.delta}` : t.delta < 0 ? `▼ ${-t.delta}` : '='}</td><td>{t.inCv ? <span className="badge b-ok">in CV</span> : <span className="badge b-err">missing</span>}</td></tr>)}
            </tbody></table></div>
          </>
        ) : <div className="empty">No report yet — click Run gap report.</div>}
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>✉ Outreach drafts for your ≥ 85% roles ({drafts.length})</h3>
          <button disabled={!!busy} onClick={() => act('drafts')}>{busy === 'drafts' ? 'Drafting…' : 'Draft now'}</button>
        </div>
        <p className="small muted">Written automatically after every ranking for roles the AI scored ≥ 0.85: hook (a real technical problem from the JD) · proof (a result from your CV — never invented; fill any [add your metric]) · ask (15-min technical chat). Send it to the engineering manager — find them in Recruiters &amp; referrals.</p>
        {drafts.map((d) => (
          <div key={d.jobId} className="tline">
            <b><a href={d.url} target="_blank" rel="noreferrer">{d.title} ↗</a></b> — {d.company} <span className="small muted">{ago(d.at)} ago</span>
            <div className="small muted">Subject: {d.subject}</div>
            <ul className="small" style={{ margin: '4px 0' }}><li>{d.hook}</li><li>{d.proof}</li><li>{d.ask}</li></ul>
            <button className="small-btn" onClick={() => navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.text}`).then(() => toast('Copied'))}>Copy</button>
          </div>
        ))}
      </div>
    </>
  );
}
