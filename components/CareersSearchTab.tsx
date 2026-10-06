'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api, dateLabel } from './api';
import ExportButton from './ExportButton';
import { FreshSelect, inWindow, newestFirst, useFresh } from './Fresh';
import SourceFilter, { Filtered, useSourceFilter } from './SourceFilter';
import { srcKeys, sourceLabel } from '@/lib/sourcetype';
import type { Profile } from '@/lib/relevance';

type Hit = { title: string; company: string; location: string; url: string; postedAt: string | null; score: number; roleRank: number; locRank: number; why: string[] };
type Res = { meta: { at: string; boards: number; ok: number; failed: string[]; jobs: number; ms: number } | null; profile: Profile; total: number; companies: number; hits: Hit[]; byRole: { role: string; n: number }[]; byLocation: { location: string; n: number }[] };

function Ordered({ items, all, onChange, label }: { items: string[]; all: string[]; onChange: (v: string[]) => void; label: string }) {
  const [custom, setCustom] = useState('');
  const move = (i: number, d: number) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div>
      <div className="small muted" style={{ marginBottom: 4 }}>{label} — top = highest priority</div>
      <ol className="prio">{items.map((x, i) => <li key={x}><span className="grow">{x}</span><button className="link" onClick={() => move(i, -1)}>▲</button><button className="link" onClick={() => move(i, 1)}>▼</button><button className="link" onClick={() => onChange(items.filter((y) => y !== x))}>✕</button></li>)}</ol>
      <div className="row" style={{ gap: 4 }}>
        {all.filter((x) => !items.includes(x)).map((x) => <span key={x} className="chip" onClick={() => onChange([...items, x])}>＋ {x}</span>)}
        <input style={{ width: 160 }} placeholder="+ your own" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { onChange([...items, custom.trim()]); setCustom(''); } }} />
      </div>
    </div>
  );
}

export default function CareersSearchTab({ toast, onAnalyze }: { toast: (s: string) => void; onAnalyze?: (url: string, company: string) => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [lib, setLib] = useState<{ roles: string[]; locations: string[] }>({ roles: [], locations: [] });
  const [r, setR] = useState<Res | null>(null);
  const [busy, setBusy] = useState('');
  const [secs, setSecs] = useState(0);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(false);
  const [freshH, setFreshH] = useFresh();
  const [noUnstated, setNoUnstated] = useState(false);
  const [co, setCo] = useState('');
  useEffect(() => { if (!busy) return; setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [busy]);

  const search = useCallback(async (refresh = false, query = q) => {
    setBusy(refresh ? 'scan' : 'search');
    try { setR(await api<Res>('/api/careers-search', { method: 'POST', body: JSON.stringify({ q: query || undefined, refresh }) })); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }, [q, toast]);
  useEffect(() => { api<{ profile: Profile; roleLib: string[]; locationLib: string[] }>('/api/profile').then((d) => { setP(d.profile); setLib({ roles: d.roleLib, locations: d.locationLib }); }); search(false, ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveProfile() {
    if (!p) return;
    setBusy('save');
    try { const d = await api<{ profile: Profile }>('/api/profile', { method: 'POST', body: JSON.stringify(p) }); setP(d.profile); setEdit(false); toast('Priorities saved — used here, in Jobs sorting and in alerts'); await search(false); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }

  const shown0 = useMemo(() => (r?.hits || []).filter((h) => inWindow(h.postedAt, freshH) && (!noUnstated || h.locRank < (r?.profile.locations.length || 0)) && (!co || h.company === co)), [r, freshH, noUnstated, co]);
  const sf = useSourceFilter(shown0, (h) => srcKeys(h.url));
  const shown = sf.visible;
  const companies = useMemo(() => Array.from(new Set((r?.hits || []).map((h) => h.company))).sort(), [r]);

  return (
    <>
      <div className="hero">
        <div>
          <h2>Careers search — every company board, one shot</h2>
          <p>Searches the job boards of every company the app knows (built-in list + companies you watch + new startups found daily + careers pages it reads) straight from their own systems — no job sites in between — and ranks what fits <b>your</b> priorities: role order, location order, experience and exclusions.</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={!!busy} onClick={() => search(true)}>{busy === 'scan' ? `Scanning every board… ${secs}s` : '🔄 Scan all boards now'}</button>
            <span className="small" style={{ color: '#fff', opacity: 0.85 }}>{r?.meta ? `index: ${r.meta.boards} boards · ${r.meta.jobs.toLocaleString()} tech roles · updated ${ago(r.meta.at)} ago (auto every 2 h)` : busy ? 'building the index…' : ''}</span>
          </div>
        </div>
        <div className="hero-stats"><div><b>{r?.total ?? '–'}</b><span>match you</span></div><div><b>{r?.companies ?? '–'}</b><span>companies</span></div></div>
      </div>

      <div className="panel">
        <div className="row">
          <input className="grow big" placeholder="Search a different role this time — e.g. MLOps engineer, AI product manager (empty = your priority roles)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(false)} />
          <button className="primary" disabled={!!busy} onClick={() => search(false)}>{busy === 'search' ? 'Searching…' : 'Search'}</button>
          <button onClick={() => setEdit(!edit)}>{edit ? 'Close priorities' : '⚙ My priorities'}</button>
        </div>
        {!edit && p && <div className="small muted" style={{ marginTop: 8 }}>Roles: {p.roles.map((x, i) => `${i + 1}. ${x}`).join(' · ')} — Locations: {p.locations.join(' → ')} — {p.expMin}-{p.expMax} yrs — excluding: {p.exclude.join(', ') || 'nothing'}</div>}
        {edit && p && (
          <div className="grid2" style={{ marginTop: 12 }}>
            <Ordered label="Roles you want" items={p.roles} all={lib.roles} onChange={(roles) => setP({ ...p, roles })} />
            <div>
              <Ordered label="Locations" items={p.locations} all={lib.locations} onChange={(locations) => setP({ ...p, locations })} />
              <div className="row" style={{ marginTop: 10 }}>
                <label className="small">Experience <input style={{ width: 56 }} type="number" value={p.expMin} onChange={(e) => setP({ ...p, expMin: +e.target.value })} /> – <input style={{ width: 56 }} type="number" value={p.expMax} onChange={(e) => setP({ ...p, expMax: +e.target.value })} /> yrs</label>
              </div>
              <input className="grow" style={{ width: '100%', marginTop: 8 }} placeholder="Exclude words (comma separated)" value={p.exclude.join(', ')} onChange={(e) => setP({ ...p, exclude: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              <input className="grow" style={{ width: '100%', marginTop: 8 }} placeholder="Must mention at least one of (optional) — e.g. LLM, Python" value={p.mustAny.join(', ')} onChange={(e) => setP({ ...p, mustAny: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              <input className="grow" style={{ width: '100%', marginTop: 8 }} placeholder="🧠 My tech stack / what I want to work on — e.g. vLLM, TensorRT-LLM, Ray, RAG, agents (drives the AI ranking)" value={(p.tech || []).join(', ')} onChange={(e) => setP({ ...p, tech: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              <button className="primary" style={{ marginTop: 10 }} disabled={busy === 'save'} onClick={saveProfile}>Save priorities</button>
            </div>
          </div>
        )}
      </div>

      {r && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            {r.byRole.filter((x) => x.n).map((x) => <span key={x.role} className="badge b-FDE">{x.role} · {x.n}</span>)}
            {r.byLocation.filter((x) => x.n).map((x) => <span key={x.location} className="badge b-dom">{x.location} · {x.n}</span>)}
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <FreshSelect hours={freshH} setHours={setFreshH} />
            <select value={co} onChange={(e) => setCo(e.target.value)}><option value="">All companies ({companies.length})</option>{companies.map((c) => <option key={c}>{c}</option>)}</select>
            <label className="small"><input type="checkbox" checked={noUnstated} onChange={(e) => setNoUnstated(e.target.checked)} /> hide “location not stated”</label>
            <span className="grow" />
            <span className="small muted">{shown.length} shown</span>
            <ExportButton title={`Careers search — ${q || 'my priority roles'}`} filename="careers-search" subtitle={`Ranked by your priorities. Roles: ${r.profile.roles.join(' > ')} · Locations: ${r.profile.locations.join(' > ')}`}
              cols={[{ header: 'Score', get: (h: Hit) => h.score, width: 32 }, { header: 'Role', get: (h) => h.title, link: (h) => h.url }, { header: 'Company', get: (h) => h.company, width: 90 }, { header: 'Location', get: (h) => h.location || 'not stated', width: 120 }, { header: 'Posted', get: (h) => (h.postedAt ? dateLabel(h.postedAt) : ''), width: 70 }, { header: 'Why', get: (h) => h.why.join(' · '), width: 150 }]} rows={shown} />
          </div>
          <div className="jobs">
            <SourceFilter counts={sf.counts} hidden={sf.hidden} setHidden={sf.setHidden} />
        {shown.slice(0, 400).map((h) => (
              <div key={h.url} className="jr-card cs-card">
                <div className="jr-body">
                  <div className="jr-top">{h.postedAt && <span className="jr-when">{ago(h.postedAt)} ago</span>}{h.postedAt && Date.now() - Date.parse(h.postedAt) < 864e5 && <span className="jr-pill early">⚡ Be an early applicant</span>}{h.why.map((w) => <span key={w} className="jr-pill gem">{w}</span>)}</div>
                  <a className="jr-title" href={h.url} target="_blank" rel="noreferrer noopener">{h.title}</a>
                  <div className="jr-co">{h.company} · 📍 {h.location || 'location not stated'}</div>
                  <div className="jr-actions" style={{ marginTop: 10 }}>
                    <a className="jr-apply" href={h.url} target="_blank" rel="noreferrer noopener">Apply on company site</a>
                    {onAnalyze && <button className="jr-ghost" onClick={() => onAnalyze(h.url, h.company)}>🔬 Analyze & prep</button>}
                  </div>
                </div>
                <div className="jr-match"><div className="jr-ring" style={{ ['--p' as string]: h.score }}><span>{h.score}</span></div><b>PRIORITY FIT</b></div>
              </div>
            ))}
          </div>
          {!shown.length && <div className="empty">Nothing matches. Add roles or locations in ⚙ My priorities, or widen “Posted”.</div>}
        </>
      )}
    </>
  );
}
