'use client';
import { useEffect, useState } from 'react';

/** Remembered (per browser) list of sources you have switched off on a page. */
export function useHiddenSources(id: string): [string[], (v: string[]) => void] {
  const key = `fj_hide_src_${id}`;
  const [hidden, set] = useState<string[]>([]);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(v)) set(v); } catch {} }, [key]);
  const save = (v: string[]) => { set(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
  return [hidden, save];
}

/** Every source on this page with its count — tap to hide / show it, “only” to keep just that one. */
export default function SourceFilter({ counts, hidden, setHidden, label = (k) => k, title = 'Sources' }: { counts: [string, number][]; hidden: string[]; setHidden: (v: string[]) => void; label?: (k: string) => string; title?: string }) {
  const [open, setOpen] = useState(true);
  if (!counts.length) return null;
  const all = counts.map(([k]) => k);
  const shown = counts.filter(([k]) => !hidden.includes(k)).reduce((n, [, c]) => n + c, 0);
  return (
    <div className="panel small" style={{ padding: '8px 12px', marginBottom: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <b style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>🔎 {title}: showing {all.length - hidden.filter((h) => all.includes(h)).length} of {all.length} ({shown} items) {open ? '▾' : '▸'}</b>
        <span className="row" style={{ gap: 6 }}>
          <button className="small-btn" onClick={() => setHidden([])}>Show all</button>
          <button className="small-btn" onClick={() => setHidden(all)}>Hide all</button>
        </span>
      </div>
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {counts.map(([k, n]) => {
            const off = hidden.includes(k);
            return (
              <span key={k} className={`chip ${off ? '' : 'on'}`} style={off ? { opacity: 0.45, textDecoration: 'line-through' } : undefined} title={off ? 'Hidden — tap to show' : 'Shown — tap to hide'}>
                <span onClick={() => setHidden(off ? hidden.filter((h) => h !== k) : [...hidden, k])}>{off ? '☐' : '☑'} {label(k)} · {n}</span>
                <span style={{ marginLeft: 6, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setHidden(all.filter((x) => x !== k))}>only</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One filter for the whole app: hide a source on any page and it is hidden on every page. */
export function useSourceFilter<T>(items: T[], keys: (t: T) => string[]) {
  const [hidden, setHidden] = useHiddenSources('all');
  const counts = Object.entries(items.reduce<Record<string, number>>((m, t) => { for (const k of keys(t)) m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const visible = hidden.length ? items.filter((t) => { const k = keys(t); return !k.length || k.some((x) => !hidden.includes(x)); }) : items;
  return { visible, counts, hidden, setHidden };
}

/** Same filter as a wrapper — for lists rendered after an early return (hooks must not move). */
export function Filtered<T>({ items, keys, children }: { items: T[]; keys: (t: T) => string[]; children: (visible: T[]) => React.ReactNode }) {
  const sf = useSourceFilter(items, keys);
  return <><SourceFilter counts={sf.counts} hidden={sf.hidden} setHidden={sf.setHidden} />{children(sf.visible)}</>;
}
