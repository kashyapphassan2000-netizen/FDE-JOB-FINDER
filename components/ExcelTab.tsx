'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, linkify } from './api';

type Row = { i: number; cells: string[]; section: boolean };
type Sheet = { name: string; title: string; header: string[]; rows: Row[] };
type RowTrack = { status: 'todo' | 'doing' | 'done' | 'skip'; notes?: string; updatedAt: string };
type Payload = { workbook: { source: string; generatedAt: string; sheets: Sheet[] }; track: Record<string, RowTrack> };

const ST: Record<RowTrack['status'], string> = { todo: '○ To do', doing: '◐ Doing', done: '● Done', skip: '– Skip' };

export default function ExcelTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [sheet, setSheet] = useState(0);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    api<Payload>('/api/workbook').then(setD).catch((e) => toast(e.message));
    try { setSheet(Number(localStorage.getItem('fj_sheet') || 0)); } catch {}
  }, [toast]);

  const sheets = d?.workbook.sheets || [];
  const track = d?.track || {};
  const key = (s: Sheet, r: Row) => `${s.name}:${r.i}`;

  const progress = useMemo(
    () =>
      sheets.map((s) => {
        const items = s.rows.filter((r) => !r.section);
        const done = items.filter((r) => ['done', 'skip'].includes(track[key(s, r)]?.status)).length;
        return { total: items.length, done };
      }),
    [sheets, track],
  );
  const overall = progress.reduce((a, p) => ({ total: a.total + p.total, done: a.done + p.done }), { total: 0, done: 0 });

  async function save(s: Sheet, r: Row, status: RowTrack['status'], notes?: string) {
    const k = key(s, r);
    try {
      const res = await api<{ entry: RowTrack }>('/api/workbook', { method: 'POST', body: JSON.stringify({ key: k, status, notes: notes ?? track[k]?.notes }) });
      setD((prev) => (prev ? { ...prev, track: { ...prev.track, [k]: res.entry } } : prev));
      setNoteKey(null);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (!d) return <div className="panel muted">Loading workbook…</div>;

  // global search across ALL sheets
  const needle = q.trim().toLowerCase();
  const searching = needle.length >= 2;
  const views: { s: Sheet; rows: Row[] }[] = searching
    ? sheets.map((s) => ({ s, rows: s.rows.filter((r) => r.cells.join(' ').toLowerCase().includes(needle)) })).filter((v) => v.rows.length)
    : [{ s: sheets[Math.min(sheet, sheets.length - 1)], rows: sheets[Math.min(sheet, sheets.length - 1)].rows }];

  return (
    <>
      <div className="panel">
        <div className="row">
          <div className="grow">
            <b>{d.workbook.source}</b> <span className="muted small">— every cell of all {sheets.length} sheets, word for word ({overall.total} trackable rows)</span>
            <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${overall.total ? (overall.done / overall.total) * 100 : 0}%` }} /></div>
            <div className="small muted">{overall.done}/{overall.total} rows done or skipped</div>
          </div>
          <input placeholder="Search all sheets…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All rows</option>
            <option value="open">Not done yet</option>
            <option value="todo">To do</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>
      <div className="sidebar">
        <div className="panel sheetlist">
          {sheets.map((s, i) => (
            <button key={s.name} className={!searching && i === sheet ? 'on' : ''} onClick={() => { setSheet(i); setQ(''); try { localStorage.setItem('fj_sheet', String(i)); } catch {} }}>
              <div className="small"><b>{s.name}</b></div>
              <div className="bar"><i style={{ width: `${progress[i].total ? (progress[i].done / progress[i].total) * 100 : 0}%` }} /></div>
              <div className="small muted">{progress[i].done}/{progress[i].total}</div>
            </button>
          ))}
        </div>
        <div>
          {views.map(({ s, rows }) => (
            <div key={s.name} style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 6px' }}>{s.name} {searching && <span className="muted small">({rows.length} matches)</span>}</h3>
              {s.title && <div className="muted small" style={{ marginBottom: 6 }}>{s.title}</div>}
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Track</th>
                      {s.header.map((h, i) => <th key={i}>{h || ' '}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((r) => {
                        if (!statusFilter || r.section) return true;
                        const st = track[key(s, r)]?.status || 'todo';
                        return statusFilter === 'open' ? !['done', 'skip'].includes(st) : st === statusFilter;
                      })
                      .map((r) => {
                        const k = key(s, r);
                        const t = track[k];
                        if (r.section)
                          return (
                            <tr key={k} className="section"><td colSpan={s.header.length + 1}>{r.cells.find((c) => c.trim())}</td></tr>
                          );
                        return (
                          <tr key={k} className={t?.status === 'done' ? 'done' : ''}>
                            <td>
                              <select value={t?.status || 'todo'} onChange={(e) => save(s, r, e.target.value as RowTrack['status'])}>
                                {(Object.keys(ST) as RowTrack['status'][]).map((x) => <option key={x} value={x}>{ST[x]}</option>)}
                              </select>
                              <div><button className="small" style={{ padding: '2px 6px', marginTop: 4 }} onClick={() => { setNoteKey(k); setNote(t?.notes || ''); }}>✎ note</button></div>
                              {noteKey === k && (
                                <div style={{ minWidth: 220 }}>
                                  <textarea value={note} onChange={(e) => setNote(e.target.value)} />
                                  <button className="primary" onClick={() => save(s, r, t?.status || 'todo', note)}>Save</button>
                                </div>
                              )}
                              {t?.notes && noteKey !== k && <div className="small muted" style={{ whiteSpace: 'pre-wrap', maxWidth: 200 }}>{t.notes}</div>}
                            </td>
                            {s.header.map((_, ci) => (
                              <td key={ci} className="cell">{linkify(r.cells[ci] || '')}</td>
                            ))}
                            {r.cells.length > s.header.length && <td className="cell">{linkify(r.cells.slice(s.header.length).filter(Boolean).join(' · '))}</td>}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {searching && !views.length && <div className="panel muted">No matches.</div>}
        </div>
      </div>
    </>
  );
}
