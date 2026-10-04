'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type W = { kind: 'ats' | 'page'; id: string; name: string; url: string; via: string; n: number; fde: number; latest: string | null; status?: { at: string; ok: boolean; roles?: number; mine?: number; error?: string } | null };

export default function WatchTab({ toast }: { toast: (s: string) => void }) {
  const [items, setItems] = useState<W[]>([]);
  const [input, setInput] = useState('');
  const [page, setPage] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const load = useCallback(() => api<{ items: W[] }>('/api/watch').then((d) => setItems(d.items)).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true);
    try { const r = await api<{ note: string }>('/api/watch', { method: 'POST', body: JSON.stringify({ input, careersUrl: page || undefined }) }); toast(r.note); setInput(''); setPage(''); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(w: W) { if (!confirm(`Stop watching ${w.name}?`)) return; await api('/api/watch', { method: 'DELETE', body: JSON.stringify({ kind: w.kind, id: w.id }) }); load(); }
  const list = items.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="hero">
        <div>
          <h2>Watch any company</h2>
          <p>Type a company name or paste its careers page / any of its job links. The app finds its job board (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday) and checks it on every refresh (~2 h); custom careers sites are read by the AI page reader. New FDE / AI roles land in Jobs, Global companies and your alerts.</p>
        </div>
        <div className="hero-stats"><div><b>{items.length}</b><span>watched by you</span></div><div><b>{items.reduce((n, w) => n + w.fde, 0)}</b><span>FDE roles open</span></div></div>
      </div>
      <div className="panel row">
        <input className="grow big" placeholder="Company name or careers / job link — e.g. Sarvam AI, https://jobs.ashbyhq.com/…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && input.trim() && add()} />
        <input className="grow" placeholder="Careers page link (optional, if the name isn’t found)" value={page} onChange={(e) => setPage(e.target.value)} />
        <button className="primary" disabled={busy || !input.trim()} onClick={add}>{busy ? 'Finding its job board…' : '＋ Watch'}</button>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="small muted">Also watched automatically: ~230 built-in company boards, the Excel careers pages and new startups found daily (see Global companies hiring).</span>
        <span className="grow" />
        <ExportButton title="Companies I watch" filename="watched-companies" cols={[{ header: 'Company', get: (w: W) => w.name, link: (w) => w.url }, { header: 'How', get: (w) => w.via, width: 90 }, { header: 'Open FDE/AI roles (for you)', get: (w) => w.n, width: 80 }, { header: 'FDE', get: (w) => w.fde, width: 40 }, { header: 'Latest role', get: (w) => (w.latest ? new Date(w.latest).toLocaleDateString('en-IN') : ''), width: 70 }]} rows={list} />
      </div>
      <div className="grid2">
        {list.map((w) => (
          <div key={w.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{w.name}</b><span className="row" style={{ gap: 4 }}>{w.fde > 0 && <span className="badge b-FDE">{w.fde} FDE</span>}<span className="badge b-AIML">{w.n} FDE/AI open</span></span></div>
            <div className="small muted">{w.via}{w.latest ? ` · latest role ${ago(w.latest)} ago` : ''}{w.status ? ` · last read ${ago(w.status.at)} ago${w.status.ok ? ` (${w.status.roles ?? 0} roles)` : ` — failed: ${w.status.error}`}` : w.kind === 'page' ? ' · waiting for the first read' : ''}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <a href={w.url} target="_blank" rel="noreferrer"><button className="small-btn primary">Careers page ↗</button></a>
              <button className="small-btn danger" onClick={() => remove(w)}>Stop watching</button>
            </div>
          </div>
        ))}
      </div>
      {!items.length && <div className="empty">You haven’t added any company yet.</div>}
    </>
  );
}
