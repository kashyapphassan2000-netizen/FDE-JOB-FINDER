'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { SEARXNG_FILES } from '@/lib/searxngFiles';

type Option = { id: string; name: string; tier: 'unlimited' | 'monthly' | 'once' | 'paid' | 'closed'; free: string; keys: string[]; url: string; steps: string[]; note?: string; engine?: string; aiPreset?: string };
type Cap = { id: string; title: string; unlocks: string; options: Option[] };
type Data = { catalog: Cap[]; status: Record<string, { on: boolean; state: string; used?: number }>; search: { live: string[]; parked: string[]; capacity: string } };
const TIER: Record<Option['tier'], [string, string]> = { unlimited: ['UNLIMITED', 'un-unl'], monthly: ['FREE EVERY MONTH', 'un-mon'], once: ['FREE ONCE', 'un-once'], paid: ['CHEAP PAY-AS-YOU-GO', 'un-paid'], closed: ['NOT AVAILABLE', 'un-closed'] };

export default function UnlimitedTab({ toast, onAiKeys }: { toast: (s: string) => void; onAiKeys: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>('searxng');
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const load = useCallback(() => api<Data>('/api/unlimited').then(setD).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  async function save(o: Option) {
    setBusy(`save:${o.id}`);
    try { for (const k of o.keys) if (vals[k]?.trim()) await api('/api/vault', { method: 'POST', body: JSON.stringify({ name: k, value: vals[k].trim() }) }); setVals((v) => { const n = { ...v }; o.keys.forEach((k) => delete n[k]); return n; }); toast('Saved (encrypted) — testing…'); await load(); await runTest(o); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function runTest(o: Option) {
    setBusy(`test:${o.id}`);
    try { const r = await api<{ ok: boolean; detail: string }>('/api/unlimited', { method: 'POST', body: JSON.stringify({ action: 'test', id: o.id }) }); setTest((t) => ({ ...t, [o.id]: r })); toast(`${o.name}: ${r.ok ? '✅ works' : '❌ ' + r.detail}`); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  const dl = (name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([SEARXNG_FILES[name]], { type: 'text/plain' })); a.download = name; a.click(); };
  if (!d) return <div className="panel muted">Loading…</div>;
  const all = d.catalog.flatMap((c) => c.options);
  const onCount = all.filter((o) => d.status[o.id]?.on).length;
  return (
    <>
      <div className="hero">
        <div>
          <h2>Unlimited setup — remove every limit</h2>
          <p>Every capacity limit in the app and every way to lift it, best first: <b>truly unlimited</b> (self-hosted / no quota) → <b>free every month</b> → <b>free once</b> → <b>cheap pay-as-you-go</b>. The app rotates across everything you connect, so free tiers stack, and a used-up engine is skipped automatically. Paste a key → it is encrypted, saved and tested on the spot. Free tiers verified October 2026.</p>
        </div>
        <div className="hero-stats"><div><b>{d.search.capacity}</b><span>web search capacity</span></div><div><b>{onCount}/{all.filter((o) => o.tier !== 'closed').length}</b><span>connected</span></div></div>
      </div>
      {d.search.parked.length > 0 && <div className="notice err small"><b>Used up right now:</b> {d.search.parked.join(', ')} — that is why search-based pages are empty. Connect any option below (SearXNG = never runs out).</div>}
      {d.catalog.map((c) => (
        <div key={c.id} className="panel">
          <h3 style={{ margin: 0 }}>{c.title}</h3>
          <div className="small muted" style={{ marginBottom: 8 }}>Unlocks: {c.unlocks}</div>
          {c.options.map((o) => {
            const st = d.status[o.id];
            const isOpen = open === o.id;
            return (
              <div key={o.id} className={`un-opt ${st?.on ? (st.state.startsWith('quota') ? 'warn' : 'on') : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : o.id)}>
                  <div><span className={`un-tier ${TIER[o.tier][1]}`}>{TIER[o.tier][0]}</span> <b>{o.name}</b> <span className="small muted">— {o.free}</span></div>
                  <span className="small">{st?.on ? (st.state.startsWith('quota') ? `🟡 ${st.state}` : '🟢 connected') : o.tier === 'closed' ? '⛔' : '⚪ not set'}{st?.used ? ` · ${st.used} used this month` : ''} {isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 8 }}>
                    <ol className="small" style={{ margin: '0 0 8px', paddingLeft: 18, lineHeight: 1.7 }}>{o.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                    {o.note && <div className="small muted" style={{ marginBottom: 6 }}>ℹ {o.note}</div>}
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <a className="small-btn primary" href={o.url} target="_blank" rel="noreferrer">Get it ↗</a>
                      {o.id === 'searxng' && ['Dockerfile', 'settings.yml', 'README.md'].map((f) => <button key={f} className="small-btn" onClick={() => dl(f)}>⬇ {f}</button>)}
                      {o.aiPreset && <button className="small-btn" onClick={onAiKeys}>Open AI &amp; Keys →</button>}
                    </div>
                    {o.keys.length > 0 && o.tier !== 'closed' && (
                      <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
                        {o.keys.map((k) => <input key={k} className="mono" type={/URL|USER|SENDER|PHONE|CHAT_ID|CX|CLIENT_ID/.test(k) ? 'text' : 'password'} style={{ flex: 1, minWidth: 200 }} placeholder={`${k}${st?.on ? ' (saved — type to replace)' : ''}`} value={vals[k] || ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />)}
                        <button className="primary" disabled={!o.keys.some((k) => vals[k]?.trim()) || busy === `save:${o.id}`} onClick={() => save(o)}>{busy === `save:${o.id}` ? 'Saving…' : 'Save & test'}</button>
                        {st?.on && <button disabled={busy === `test:${o.id}`} onClick={() => runTest(o)}>{busy === `test:${o.id}` ? 'Testing…' : 'Test'}</button>}
                      </div>
                    )}
                    {test[o.id] && <div className={`notice small ${test[o.id].ok ? 'ok' : 'warn'}`} style={{ marginTop: 6 }}>{test[o.id].ok ? '✅' : '❌'} {test[o.id].detail}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div className="panel small muted">Honest note: “unlimited” really exists only for things you host (SearXNG, Ollama) or that have no quota (company job boards, LinkedIn public jobs, Telegram, Google sign-in). Everything else is a free allowance per account — the app stacks them and parks one when it runs out. One account per provider: creating extra accounts to dodge limits breaks their terms and gets keys banned.</div>
    </>
  );
}
