'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';
import SourceFilter, { Filtered, useSourceFilter } from './SourceFilter';
import { srcKeys, sourceLabel } from '@/lib/sourcetype';

type W = {
  id: string; name: string; kind: 'ats' | 'page'; ats?: string; url: string; locations: string[]; status: 'ok' | 'readable' | 'unreadable' | 'pending'; note: string;
  lastChecked?: string; lastTotal?: number; lastRelevant?: number; baseline?: boolean; error?: string; feed: { n: number; fde: number }; newHits: number;
};
type Hit = { id: string; company: string; title: string; location: string; url: string; why: string; foundAt: string; emailed: boolean };
type Payload = { items: W[]; hits: Hit[]; meta: { at: string; log: string[] } | null; notifyTo: string; locationPresets: string[] };
const DEFAULT_LOCS = ['Bengaluru', 'Remote (India OK)'];

function LocPicker({ value, onChange, presets }: { value: string[]; onChange: (v: string[]) => void; presets: string[] }) {
  const [custom, setCustom] = useState('');
  const toggle = (l: string) => onChange(value.includes(l) ? value.filter((x) => x !== l) : [...value, l]);
  return (
    <div className="row" style={{ gap: 6 }}>
      {presets.map((l) => <span key={l} className={`chip ${value.includes(l) ? 'on' : ''}`} onClick={() => toggle(l)}>{l}</span>)}
      {value.filter((v) => !presets.includes(v)).map((l) => <span key={l} className="chip on" onClick={() => toggle(l)}>{l} ✕</span>)}
      <input style={{ width: 150 }} placeholder="+ other city" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { onChange([...value, custom.trim()]); setCustom(''); } }} />
    </div>
  );
}

export default function WatchTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [mode, setMode] = useState<'one' | 'bulk'>('one');
  const [input, setInput] = useState('');
  const [page, setPage] = useState('');
  const [bulk, setBulk] = useState('');
  const [locs, setLocs] = useState<string[]>(DEFAULT_LOCS);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<{ line: string; ok: boolean; name: string; note: string; url?: string }[]>([]);
  const [edit, setEdit] = useState<string | null>(null);
  const [editLocs, setEditLocs] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const load = useCallback(() => api<Payload>('/api/watch').then(setD).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy('add'); setResults([]);
    try {
      if (mode === 'bulk') {
        const r = await api<{ results: typeof results }>('/api/watch', { method: 'POST', body: JSON.stringify({ action: 'bulk', text: bulk, locations: locs }) });
        setResults(r.results); toast(`${r.results.filter((x) => x.ok).length}/${r.results.length} mapped`); setBulk('');
      } else {
        const r = await api<{ entry: W; note: string }>('/api/watch', { method: 'POST', body: JSON.stringify({ action: 'add', input, careersUrl: page || undefined, locations: locs }) });
        setResults([{ line: input, ok: r.entry.status !== 'unreadable', name: r.entry.name, note: r.note, url: r.entry.url }]); setInput(''); setPage('');
      }
      load();
    } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function checkNow() {
    setBusy('check');
    try { const r = await api<{ checked: number; newHits: number; emailed: boolean }>('/api/watch', { method: 'POST', body: JSON.stringify({ action: 'check' }) }); toast(`Checked ${r.checked} companies · ${r.newHits} new AI/FDE roles${r.emailed ? ' · emailed you' : ''}`); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function saveLocs(id: string) { await api('/api/watch', { method: 'POST', body: JSON.stringify({ action: 'locations', id, locations: editLocs }) }); setEdit(null); load(); }
  async function remove(w: W) { if (!confirm(`Stop watching ${w.name}?`)) return; await api('/api/watch', { method: 'DELETE', body: JSON.stringify({ id: w.id }) }); load(); }

  if (!d) return <div className="panel muted">Loading…</div>;
  const list = d.items.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase()));
  const presets = d.locationPresets;
  const ST: Record<W['status'], [string, string]> = { ok: ['b-ok', 'job board · exact'], readable: ['b-AIML', 'careers page · AI reader'], unreadable: ['b-err', 'not readable'], pending: ['b-skip', 'pending'] };

  return (
    <>
      <div className="hero">
        <div>
          <h2>Watch companies → get an email for every new AI / FDE role</h2>
          <p>Add companies one by one or in bulk. Each one is mapped to its job board (exact) or its careers page (AI reader) and you see right away whether watching it works. About every 2 hours the watcher checks all of them and emails <b>{d.notifyTo || 'you (set DIGEST_TO)'}</b> only the <b>new</b> jobs that need AI or FDE people — FDE, AI/ML, and roles like “Software Engineer, LLM platform” — in the locations you picked for that company.</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={!!busy} onClick={checkNow}>{busy === 'check' ? 'Checking all companies…' : '🔄 Check all now'}</button>
            <span className="small" style={{ color: '#fff', opacity: 0.85 }}>{d.meta ? `last check ${ago(d.meta.at)} ago · automatic every ~2 h` : 'not checked yet'}</span>
          </div>
        </div>
        <div className="hero-stats"><div><b>{d.items.length}</b><span>watched</span></div><div><b>{d.hits.length}</b><span>new roles found</span></div></div>
      </div>

      <div className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="seg"><button className={mode === 'one' ? 'on' : ''} onClick={() => setMode('one')}>Add one</button><button className={mode === 'bulk' ? 'on' : ''} onClick={() => setMode('bulk')}>Add in bulk</button></span>
          <span className="small muted">{mode === 'bulk' ? 'One per line: name, or careers / job link, or “Name | link | Bengaluru, Hyderabad”. Up to 40 at a time.' : 'Company name, or its careers page / any job link.'}</span>
        </div>
        {mode === 'one' ? (
          <div className="row">
            <input className="grow big" placeholder="Best: paste the careers page link (https://careers.company.com). A name also works: e.g. Sarvam AI" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && input.trim() && add()} />
            <input className="grow" placeholder="Careers page link (optional)" value={page} onChange={(e) => setPage(e.target.value)} />
          </div>
        ) : (
          <textarea className="tabprompt" rows={6} placeholder={'Sarvam AI\nKrutrim | https://www.olakrutrim.com/careers\nhttps://jobs.ashbyhq.com/glean\nGoogle | | Bengaluru, Hyderabad'} value={bulk} onChange={(e) => setBulk(e.target.value)} />
        )}
        <div style={{ margin: '10px 0' }}><div className="small muted" style={{ marginBottom: 4 }}>Locations to watch (hiring differs by location — pick all that work for you):</div><LocPicker value={locs} onChange={setLocs} presets={presets} /></div>
        <button className="primary" disabled={!!busy || (mode === 'one' ? !input.trim() : !bulk.trim())} onClick={add}>{busy === 'add' ? 'Mapping careers pages…' : mode === 'bulk' ? '＋ Map & watch all' : '＋ Map & watch'}</button>
        {results.length > 0 && (
          <div style={{ marginTop: 10 }}>{results.map((r, i) => <div key={i} className={`notice small ${r.ok ? 'ok' : 'warn'}`} style={{ marginBottom: 6 }}><b>{r.name}</b> — {r.note}{r.url ? <> · <a href={r.url} target="_blank" rel="noreferrer">check it’s the right company ↗</a></> : null}</div>)}
          <div className="small muted">Wrong company (same name, other country)? Click “Stop watching” on it and paste that company’s careers page link instead — a link always maps exactly.</div></div>
        )}
      </div>

      {d.hits.length > 0 && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>🔔 New AI / FDE roles at your companies</h3>
            <ExportButton title="New AI / FDE roles at watched companies" filename="watch-new-roles" cols={[{ header: 'Found', get: (h: Hit) => new Date(h.foundAt).toLocaleString('en-IN'), width: 80 }, { header: 'Company', get: (h) => h.company, width: 90 }, { header: 'Role', get: (h) => h.title, link: (h) => h.url }, { header: 'Location', get: (h) => h.location, width: 110 }, { header: 'Why', get: (h) => h.why, width: 110 }]} rows={d.hits} />
          </div>
          <Filtered items={d.hits} keys={(h) => srcKeys(h.url)}>{(hits) => hits.slice(0, 40).map((h) => <div key={h.id + h.foundAt} className="tline"><span className="badge b-date">{ago(h.foundAt)} ago</span> <b>{h.company}</b> · <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> <span className="small muted">· {h.location} · {h.why}{h.emailed ? ' · ✉ emailed' : ''}</span></div>)}</Filtered>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <input placeholder="Filter companies…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        <ExportButton title="Companies I watch" filename="watched-companies" cols={[{ header: 'Company', get: (w: W) => w.name, link: (w) => w.url }, { header: 'Mapping', get: (w) => ST[w.status][1], width: 90 }, { header: 'Locations', get: (w) => (w.locations.length ? w.locations.join(', ') : 'Bengaluru office / remote India'), width: 130 }, { header: 'Roles last check', get: (w) => w.lastTotal ?? '', width: 55 }, { header: 'AI/FDE matches', get: (w) => w.lastRelevant ?? '', width: 55 }, { header: 'Last check', get: (w) => (w.lastChecked ? new Date(w.lastChecked).toLocaleString('en-IN') : ''), width: 90 }]} rows={list} />
      </div>
      <div className="grid2">
        {list.map((w) => (
          <div key={w.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{w.name}</b>
              <span className="row" style={{ gap: 4 }}><span className={`badge ${ST[w.status][0]}`}>{ST[w.status][1]}{w.ats ? ` · ${w.ats}` : ''}</span>{w.newHits > 0 && <span className="badge b-new">{w.newHits} new</span>}</span>
            </div>
            <div className="small muted" style={{ margin: '4px 0' }}>{w.note}</div>
            <div className="small">{w.lastChecked ? <>Last check {ago(w.lastChecked)} ago: <b>{w.lastTotal ?? 0}</b> roles, <b>{w.lastRelevant ?? 0}</b> need AI/FDE in your locations{w.baseline ? '' : ' (baseline)'}</> : 'Not checked yet — runs within ~2 h (or press “Check all now”).'}{w.error ? <span style={{ color: 'var(--err)' }}> · last error: {w.error}</span> : null}</div>
            <div style={{ margin: '6px 0' }}>
              {edit === w.id ? (
                <><LocPicker value={editLocs} onChange={setEditLocs} presets={presets} /><div className="row" style={{ marginTop: 6 }}><button className="small-btn primary" onClick={() => saveLocs(w.id)}>Save locations</button><button className="small-btn" onClick={() => setEdit(null)}>Cancel</button></div></>
              ) : (
                <div className="row" style={{ gap: 4 }}>📍 {(w.locations.length ? w.locations : ['Bengaluru office / remote India (default)']).map((l) => <span key={l} className="badge b-dom">{l}</span>)}<button className="link" onClick={() => { setEdit(w.id); setEditLocs(w.locations); }}>edit</button></div>
              )}
            </div>
            <div className="row">
              {w.url && <a href={w.url} target="_blank" rel="noreferrer"><button className="small-btn primary">Careers page ↗</button></a>}
              <button className="small-btn danger" onClick={() => remove(w)}>Stop watching</button>
            </div>
          </div>
        ))}
      </div>
      {!d.items.length && <div className="empty">No companies yet — add one above.</div>}
      {d.meta && <details className="small muted" style={{ marginTop: 10 }}><summary>Last check log</summary><ul>{d.meta.log.map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
    </>
  );
}
