'use client';
import { useEffect, useState } from 'react';
import { api } from './api';

export type FitJob = { id: string; title: string; company: string; location: string; url: string; description?: string };

/** Side panel: AI fit analysis of one job vs your CV + ready-to-send DM / cover note. */
export default function FitDrawer({ job, onClose, onApplied }: { job: FitJob; onClose: () => void; onApplied?: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  async function load(refresh = false) {
    setBusy(true);
    setErr('');
    try {
      setD(await api('/api/ai/fit', { method: 'POST', body: JSON.stringify({ job, refresh }) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, [job.id]);

  const copy = (t: string) => navigator.clipboard?.writeText(t);
  const List = ({ k, label }: { k: string; label: string }) =>
    Array.isArray(d?.[k]) && d[k].length ? (<><h4 style={{ margin: '10px 0 4px' }}>{label}</h4><ul style={{ margin: 0, paddingLeft: 18 }}>{d[k].map((x: string, i: number) => <li key={i} className="small">{x}</li>)}</ul></>) : null;

  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>AI fit check</b>
          <button onClick={onClose}>✕</button>
        </div>
        <h3 style={{ margin: '8px 0 2px' }}>{job.title}</h3>
        <div className="small muted">{job.company} · {job.location}</div>
        <div className="row" style={{ margin: '10px 0' }}>
          <a href={job.url} target="_blank" rel="noreferrer noopener"><button className="primary">Apply ↗</button></a>
          {onApplied && <button onClick={onApplied}>Mark applied</button>}
          <button disabled={busy} onClick={() => load(true)}>Re-run</button>
        </div>
        {busy && <div className="muted small">Reading the job page and comparing with your CV…</div>}
        {err && <div className="notice err small">{err}</div>}
        {d && !busy && (
          <>
            <div className="row">
              {typeof d.fit_score === 'number' && <span className="score" style={{ fontSize: 28 }}>{d.fit_score}</span>}
              {d.verdict && <span className="badge b-ok" style={{ fontSize: 13 }}>{d.verdict}</span>}
            </div>
            {d.why && <p className="small">{d.why}</p>}
            {d.india_eligible && <p className="small"><b>India eligible:</b> {d.india_eligible}</p>}
            <List k="matching" label="✅ You match" />
            <List k="gaps" label="⚠️ Gaps" />
            <List k="fix_gaps_fast" label="🛠 Fix fast" />
            <List k="red_flags" label="🚩 Red flags" />
            {d.pitch && <><h4 style={{ margin: '10px 0 4px' }}>Lead with</h4><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{Array.isArray(d.pitch) ? d.pitch.join('\n') : d.pitch}</div></>}
            {d.cold_dm && <><h4 style={{ margin: '10px 0 4px' }}>Cold DM <button className="small" onClick={() => copy(d.cold_dm)}>copy</button></h4><div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{d.cold_dm}</div></>}
            {d.cover_note && <><h4 style={{ margin: '10px 0 4px' }}>Cover note <button className="small" onClick={() => copy(d.cover_note)}>copy</button></h4><div className="card small" style={{ whiteSpace: 'pre-wrap' }}>{d.cover_note}</div></>}
            <div className="muted small" style={{ marginTop: 8 }}>{d._model}</div>
          </>
        )}
      </aside>
    </div>
  );
}
