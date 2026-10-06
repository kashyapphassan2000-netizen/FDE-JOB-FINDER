'use client';
import { useEffect, useState } from 'react';

/**
 * ONE freshness window for the whole app. Default: STRICT last 24 h, newest first.
 * Change it on any page → every page follows (saved in this browser). Undated items are hidden unless "any time".
 */
export const FRESH_OPTS: [number, string][] = [[3, 'last 3 h'], [6, 'last 6 h'], [12, 'last 12 h'], [24, 'last 24 h'], [48, 'last 2 days'], [72, 'last 3 days'], [168, 'last 7 days'], [0, 'any time']];
const KEY = 'fj_fresh_h_v1';
const listeners = new Set<(h: number) => void>();

export function useFresh(): [number, (h: number) => void] {
  const [h, set] = useState(24);
  useEffect(() => {
    try { const v = Number(localStorage.getItem(KEY)); if (localStorage.getItem(KEY) !== null && FRESH_OPTS.some(([x]) => x === v)) set(v); } catch {}
    listeners.add(set);
    return () => { listeners.delete(set); };
  }, []);
  const save = (v: number) => { try { localStorage.setItem(KEY, String(v)); } catch {} listeners.forEach((l) => l(v)); };
  return [h, save];
}

/** Is this date inside the window? Undated → only when the window is "any time". */
export function inWindow(iso: string | null | undefined, hours: number): boolean {
  if (!hours) return true;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && Date.now() - t <= hours * 36e5;
}
export const newestFirst = <T,>(get: (t: T) => string | null | undefined) => (a: T, b: T) => (Date.parse(get(b) || '') || 0) - (Date.parse(get(a) || '') || 0);

export function FreshSelect({ hours, setHours, hidden }: { hours: number; setHours: (h: number) => void; hidden?: number }) {
  return (
    <span className="row" style={{ gap: 6, alignItems: 'center' }}>
      <select value={hours} onChange={(e) => setHours(Number(e.target.value))} title="Freshness window — applies on every page" style={hours === 24 ? { borderColor: 'var(--mint)' } : undefined}>
        {FRESH_OPTS.map(([v, l]) => <option key={v} value={v}>🕒 Posted: {l}{v === 24 ? ' (strict default)' : ''}</option>)}
      </select>
      {hidden ? <span className="small muted">{hidden} older hidden</span> : null}
    </span>
  );
}
