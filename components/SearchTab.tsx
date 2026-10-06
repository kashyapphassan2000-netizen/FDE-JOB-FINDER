'use client';
import { useEffect, useMemo, useState } from 'react';
import { ago, api, setTrack } from './api';
import ExportButton from './ExportButton';
import { ReachButton, SaveButton } from './ReachButton';
import { SOURCE_ICON, SOURCE_TYPES, sourceType } from '@/lib/sourcetype';

type Hit = { title: string; company: string; location: string; url: string; postedAt?: string | null; salary?: string; source: string; text?: string };
type Res = { q: string; parsed?: { role: string; location: string; remote: boolean }; ms: number; total: number; hits: Hit[]; bySource: { source: string; n: number }[]; boardsSearched: number; errors: string[]; captureLinks: { label: string; url: string }[]; stripped: number };

export default function SearchTab({ q, toast, onOutreach }: { q: string; toast: (s: string) => void; onOutreach?: (company: string, role: string) => void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [any, setAny] = useState(false);
  const [src, setSrc] = useState('');
  const [stype, setStype] = useState('');
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!q) return;
    let alive = true;
    setBusy(true); setRes(null); setSrc(''); setSecs(0);
    const iv = setInterval(() => setSecs((s) => s + 1), 1000);
    api<Res>(`/api/search?q=${encodeURIComponent(q)}${any ? '&any=1' : ''}`)
      .then((r) => alive && setRes(r))
      .catch((e) => toast(e.message))
      .finally(() => { clearInterval(iv); alive && setBusy(false); });
    return () => { alive = false; clearInterval(iv); };
  }, [q, any, toast]);

  const shown = useMemo(() => (res?.hits || []).filter((h) => (!src || h.source === src) && (!stype || sourceType(h.url) === stype)), [res, src, stype]);
  if (!q) return <div className="empty">Type any role in the search bar at the top — e.g. “MLOps engineer”, “solutions architect”, “AI product manager”, “computer vision”.</div>;

  return (
    <>
      <div className="hero">
        <div>
          <h2>“{q}”</h2>
          {res?.parsed && <p className="small" style={{ margin: '2px 0' }}>Role: <b>{res.parsed.role}</b> · Where: <b>{res.parsed.location || (any ? 'anywhere' : 'your locations')}{res.parsed.remote ? ' + remote' : ''}</b> — type any role in any city/country, e.g. “data engineer in Berlin”, “AI PM remote”.</p>}
          <p>{busy ? `Searching every source… ${secs}s (your list, agent finds, ~230 company boards, Amazon, Microsoft, Unstop, Remotive, 80,000 Hours, Mercor, JPMorgan)` : res ? `${res.total} results from ${res.bySource.length} sources in ${(res.ms / 1000).toFixed(0)}s · ${res.boardsSearched} sources searched${res.stripped ? ` · ${res.stripped} hidden by your Bengaluru/remote rule` : ''}` : ''}</p>
        </div>
        <label className="small" style={{ color: '#fff' }}><input type="checkbox" checked={any} onChange={(e) => setAny(e.target.checked)} /> ignore my location rule</label>
      </div>
      {res && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className={`chip ${!src ? 'on' : ''}`} onClick={() => setSrc('')}>All · {res.total}</span>
            {SOURCE_TYPES.map((t) => { const n = res.hits.filter((h) => sourceType(h.url) === t).length; return n ? <span key={t} className={`chip ${stype === t ? 'on' : ''}`} onClick={() => setStype(stype === t ? '' : t)}>{SOURCE_ICON[t]} {t} · {n}</span> : null; })}
            {res.bySource.map((s) => <span key={s.source} className={`chip ${src === s.source ? 'on' : ''}`} onClick={() => setSrc(s.source)}>{s.source} · {s.n}</span>)}
            <span className="grow" />
            <ExportButton title={`Search: ${q}`} subtitle={`${shown.length} results${src ? ` from ${src}` : ''} · ${any ? 'location rule ignored' : 'Bengaluru office or remote-from-India only'}`} filename={`search-${q}`}
              cols={[{ header: 'Role', get: (h: Hit) => h.title, link: (h) => h.url }, { header: 'Company', get: (h) => h.company, width: 100 }, { header: 'Location', get: (h) => h.location, width: 100 },
                { header: 'Posted', get: (h) => (h.postedAt ? `${ago(h.postedAt)} ago` : ''), width: 50 }, { header: 'Salary', get: (h) => h.salary || '', width: 70 }, { header: 'Source', get: (h) => h.source, width: 80 }]}
              rows={shown} />
          </div>
          <div className="panel">
            <b>Also search these (they need your login / block servers) → open, then 📥 Capture:</b>
            <div className="row" style={{ marginTop: 6 }}>{res.captureLinks.map((l) => <a key={l.url} className="pill link-pill" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}</div>
          </div>
          {res.errors.length > 0 && <div className="small muted" style={{ marginBottom: 8 }}>Skipped: {res.errors.join(' · ')}</div>}
          <div className="finds">
            {shown.map((h) => (
              <div key={h.url} className="find">
                <div className="find-head"><span className="kind k-job">{h.source}</span><span className="small muted" style={{ marginLeft: 'auto' }}>{h.postedAt ? `posted ${ago(h.postedAt)}` : ''}</span></div>
                <a className="find-title" href={h.url} target="_blank" rel="noreferrer">{h.title}</a>
                <div className="job-sub"><b>{h.company}</b>{h.location && <span>· {h.location}</span>}{h.salary && <span className="badge b-money">{h.salary}</span>}</div>
                
                <div className="row" style={{ marginTop: 8, gap: 6 }}>
                  <a className="btn primary small-btn" href={h.url} target="_blank" rel="noreferrer">Open / Apply</a>
                  <button className="small-btn" onClick={() => setTrack({ id: h.url, title: h.title, company: h.company, location: h.location, url: h.url, sources: [`search:${h.source}`], categories: [], postedAt: h.postedAt || null }, 'saved').then(() => toast('Saved to Tracker'))}>Save</button>
                  <ReachButton item={{ title: h.title, company: h.company.replace(/\s*\(@.*$/, ''), url: h.url, location: h.location, text: h.text }} toast={toast} />
                  <SaveButton item={{ title: h.title, company: h.company, url: h.url, location: h.location, text: h.text }} toast={toast} folder={/posts/.test(h.source) ? 'Saved posts' : 'Saved jobs'} label="🔖 Notepad" />
                  {onOutreach && h.company && <button className="small-btn" onClick={() => onOutreach(h.company.replace(/\s*\(@.*$/, '').replace(/ via mercor$/i, ''), h.title)}>✉ People</button>}
                </div>
              </div>
            ))}
            {!shown.length && <div className="empty">No matches{src ? ' in this source' : ''}. Try a broader term, tick “ignore my location rule”, or use the capture links above.</div>}
          </div>
        </>
      )}
    </>
  );
}
