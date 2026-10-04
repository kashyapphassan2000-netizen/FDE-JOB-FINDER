'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import ExportButton from './ExportButton';

type Row = { i: number; cells: string[]; section: boolean };
type Sheet = { name: string; title: string; header: string[]; rows: Row[] };
type RowTrack = { status: 'todo' | 'doing' | 'done' | 'skip'; notes?: string; updatedAt: string };
type Payload = { workbook: { source: string; generatedAt: string; sheets: Sheet[] }; track: Record<string, RowTrack> };

const ST: Record<RowTrack['status'], { label: string; cls: string }> = {
  todo: { label: 'To do', cls: 'xs-todo' }, doing: { label: 'Doing', cls: 'xs-doing' }, done: { label: 'Done', cls: 'xs-done' }, skip: { label: 'Skip', cls: 'xs-skip' },
};
const FILTERS: [string, string][] = [['', 'All'], ['open', 'Not done'], ['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done'], ['skip', 'Skipped']];

// icon per sheet from its name (purely visual)
function iconFor(name: string): string {
  const n = name.toLowerCase();
  const map: [RegExp, string][] = [
    [/salary|pay|comp/, '💰'], [/referr/, '🤝'], [/linkedin/, '🔗'], [/twitter|\bx\b/, '𝕏'], [/remote/, '🌍'], [/bangalore|bengaluru|blr/, '📍'],
    [/startup|funding|yc/, '🚀'], [/hackathon|competition/, '🏆'], [/open.?source/, '🧩'], [/cert|credential/, '🎓'], [/community|telegram|reddit|discord/, '👥'],
    [/semi|chip|embedded/, '🔧'], [/interview|prep/, '🎯'], [/project|portfolio/, '🛠'], [/platform|board|portal/, '🗂'], [/company|careers/, '🏢'],
    [/recruit|outreach|email|cold/, '✉️'], [/news|newsletter/, '📰'], [/gig|freelance|contract|market/, '💼'], [/hack|trick|strategy/, '💡'], [/plan|daily|routine|schedule/, '📅'],
  ];
  for (const [rx, ic] of map) if (rx.test(n)) return ic;
  return '📄';
}

/** Cell text with links shown as tidy chips instead of long raw URLs. */
function Cell({ text, first }: { text: string; first: boolean }) {
  if (!text) return <span className="muted">—</span>;
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <span className={first ? 'xl-first' : ''}>
      {parts.map((p, i) => {
        if (!/^https?:\/\//.test(p)) return p;
        let host = p;
        try { host = new URL(p).hostname.replace(/^www\./, ''); } catch {}
        return <a key={i} className="xl-link" href={p} target="_blank" rel="noreferrer noopener" title={p}>{host} ↗</a>;
      })}
    </span>
  );
}

function Ring({ pct, size = 64 }: { pct: number; size?: number }) {
  return <div className="xl-ring" style={{ width: size, height: size, ['--p' as string]: pct }}><span>{Math.round(pct)}<small>%</small></span></div>;
}

export default function ExcelTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [sheet, setSheet] = useState(0);
  const [q, setQ] = useState('');
  const [sq, setSq] = useState('');
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
    () => sheets.map((s) => {
      const items = s.rows.filter((r) => !r.section);
      const done = items.filter((r) => ['done', 'skip'].includes(track[key(s, r)]?.status)).length;
      const doing = items.filter((r) => track[key(s, r)]?.status === 'doing').length;
      return { total: items.length, done, doing };
    }),
    [sheets, track],
  );
  const overall = progress.reduce((a, p) => ({ total: a.total + p.total, done: a.done + p.done, doing: a.doing + p.doing }), { total: 0, done: 0, doing: 0 });

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
  const pick = (i: number) => { setSheet(i); setQ(''); try { localStorage.setItem('fj_sheet', String(i)); } catch {} window.scrollTo({ top: 0, behavior: 'smooth' }); };

  if (!d) return <div className="panel muted">Loading workbook…</div>;

  const needle = q.trim().toLowerCase();
  const searching = needle.length >= 2;
  const cur = Math.min(sheet, sheets.length - 1);
  const views: { s: Sheet; rows: Row[]; idx: number }[] = searching
    ? sheets.map((s, idx) => ({ s, idx, rows: s.rows.filter((r) => r.cells.join(' ').toLowerCase().includes(needle)) })).filter((v) => v.rows.length)
    : [{ s: sheets[cur], rows: sheets[cur].rows, idx: cur }];
  const overallPct = overall.total ? (overall.done / overall.total) * 100 : 0;
  const listed = sheets.map((s, i) => ({ s, i })).filter(({ s }) => !sq || `${s.name} ${s.title}`.toLowerCase().includes(sq.toLowerCase()));

  return (
    <>
      <div className="hero xl-hero">
        <div>
          <h2 className="xl-title">📊 {d.workbook.source.replace(/\.xlsx?$/i, '').replace(/_/g, ' ')}</h2>
          <p>All {sheets.length} sheets of your AI Job Search Master Excel, word for word. Mark every row To do → Doing → Done, add notes, search across all sheets, export any sheet as a PDF.</p>
          <input className="xl-search" placeholder="🔍 Search every sheet — company, platform, keyword…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="xl-hero-right">
          <Ring pct={overallPct} size={96} />
          <div className="hero-stats">
            <div><b>{overall.done}</b><span>done</span></div>
            <div><b>{overall.doing}</b><span>in progress</span></div>
            <div><b>{overall.total - overall.done}</b><span>left</span></div>
          </div>
        </div>
      </div>

      <div className="xl-layout">
        <aside className="xl-sheets">
          <input placeholder="Find a sheet…" value={sq} onChange={(e) => setSq(e.target.value)} />
          <div className="xl-sheetlist">
            {listed.map(({ s, i }) => {
              const pr = progress[i];
              const pct = pr.total ? (pr.done / pr.total) * 100 : 0;
              return (
                <button key={s.name} className={`xl-sheet ${!searching && i === cur ? 'on' : ''}`} onClick={() => pick(i)}>
                  <span className="xl-ic">{iconFor(`${s.name} ${s.title}`)}</span>
                  <span className="xl-meta">
                    <b>{s.name.replace(/_/g, ' ')}</b>
                    <span className="xl-mini"><i style={{ width: `${pct}%` }} /></span>
                    <small>{pr.done}/{pr.total} {pct === 100 && pr.total ? '✓' : ''}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="xl-main">
          {views.map(({ s, rows, idx }) => {
            const pr = progress[idx];
            const visible = rows.filter((r) => {
              if (!statusFilter || r.section) return true;
              const st = track[key(s, r)]?.status || 'todo';
              return statusFilter === 'open' ? !['done', 'skip'].includes(st) : st === statusFilter;
            });
            const cols = s.header.map((h, i) => ({ h: h || ' ', i })).filter(({ i }) => rows.some((r) => (r.cells[i] || '').trim()));
            return (
              <div key={s.name} className="xl-card">
                <div className="xl-card-head">
                  <span className="xl-ic big">{iconFor(`${s.name} ${s.title}`)}</span>
                  <div className="grow">
                    <h3>{s.name.replace(/_/g, ' ')} {searching && <span className="badge b-dom">{rows.length} matches</span>}</h3>
                    {s.title && <div className="small muted">{s.title}</div>}
                  </div>
                  <Ring pct={pr.total ? (pr.done / pr.total) * 100 : 0} size={56} />
                </div>
                {!searching && (
                  <div className="xl-toolbar">
                    <span className="seg">{FILTERS.map(([v, l]) => <button key={v} className={statusFilter === v ? 'on' : ''} onClick={() => setStatusFilter(v)}>{l}</button>)}</span>
                    <span className="grow" />
                    <span className="small muted">This sheet:</span>
                    <ExportButton title={`Excel sheet: ${s.title || s.name}`} subtitle={`${d.workbook.source} · ${pr.done}/${pr.total} rows done`} filename={`excel-${s.name}`}
                      sections={[{ title: `${s.title || s.name} (${rows.length} rows)`, headers: [...s.header.slice(0, 7), 'My status'], rows: rows.map((r) => [...s.header.slice(0, 7).map((_, i) => r.cells[i] || ''), track[key(s, r)]?.status || '']) }]} />
                    <span className="small muted">All sheets:</span>
                    <ExportButton title="Excel — all sheets" subtitle={`${d.workbook.source} · all ${sheets.length} sheets`} filename="excel-all-sheets"
                      sections={sheets.map((x) => ({ title: `${x.title || x.name} (${x.rows.length} rows)`, headers: [...x.header.slice(0, 7), 'My status'], rows: x.rows.map((r) => [...x.header.slice(0, 7).map((_, i) => r.cells[i] || ''), track[key(x, r)]?.status || '']) }))} />
                  </div>
                )}
                <div className="xl-tablewrap">
                  <table className="xl-table">
                    <thead>
                      <tr><th className="xl-st">Status</th>{cols.map(({ h, i }) => <th key={i}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => {
                        const k = key(s, r);
                        const t = track[k];
                        if (r.section) return <tr key={k} className="xl-section"><td colSpan={cols.length + 1}>{r.cells.find((c) => c.trim())}</td></tr>;
                        const st = t?.status || 'todo';
                        return (
                          <tr key={k} className={`xl-row ${st}`}>
                            <td className="xl-st">
                              <select className={`xl-pill ${ST[st].cls}`} value={st} onChange={(e) => save(s, r, e.target.value as RowTrack['status'])}>
                                {(Object.keys(ST) as RowTrack['status'][]).map((x) => <option key={x} value={x}>{ST[x].label}</option>)}
                              </select>
                              <button className="xl-note-btn" onClick={() => { setNoteKey(noteKey === k ? null : k); setNote(t?.notes || ''); }}>{t?.notes ? '📝 note' : '＋ note'}</button>
                              {noteKey === k && (
                                <div className="xl-note-edit">
                                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your note…" />
                                  <button className="small-btn primary" onClick={() => save(s, r, st, note)}>Save</button>
                                </div>
                              )}
                              {t?.notes && noteKey !== k && <div className="xl-note">{t.notes}</div>}
                            </td>
                            {cols.map(({ i }, ci) => <td key={i} data-label={s.header[i] || ''}><Cell text={(r.cells[i] || '').trim()} first={ci === 0} /></td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!visible.filter((r) => !r.section).length && <div className="empty" style={{ margin: 12 }}>No rows with this status.</div>}
                </div>
                {searching && <div className="row" style={{ padding: '10px 14px' }}><button className="small-btn" onClick={() => pick(idx)}>Open this sheet →</button></div>}
              </div>
            );
          })}
          {searching && !views.length && <div className="empty">No matches in any sheet.</div>}
        </section>
      </div>
    </>
  );
}
