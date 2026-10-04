'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api, dateLabel } from './api';
import ExportButton from './ExportButton';

type Role = { title: string; url: string; location: string; posted: string | null; fde: boolean };
type Co = {
  key: string; name: string; careersUrl: string; careersKind: string; ats?: string; source: string; tags: string[]; newStartup: boolean; fundedAt?: string; teamSize?: number;
  fde: number; aiml: number; blr: number; remoteIn: number; new24h: number; latest: string | null; roles: Role[]; hiresFde: boolean; firstSeen: string; lastFdeSeen?: string;
};
type Payload = { companies: Co[]; at: string; counts: Record<string, number>; jobsRefreshed: string | null; startupsScanned: string | null; startupLog: string[] };

const ROLE_OPTS = { fde: 'FDE roles open now', fdeEver: 'Hires FDEs (now or before)', ai: 'FDE or AI/ML roles open', all: 'All companies (incl. no open role)' } as const;

export default function DirectoryTab({ toast, onOutreach }: { toast: (s: string) => void; onOutreach?: (company: string, role: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [role, setRole] = useState<keyof typeof ROLE_OPTS>('fde');
  const [region, setRegion] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('fde');
  const load = useCallback(() => api<Payload>('/api/directory').then(setD).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => (d?.companies || []).filter((c) => {
    if (role === 'fde' && c.fde === 0) return false;
    if (role === 'fdeEver' && !c.hiresFde) return false;
    if (role === 'ai' && c.fde + c.aiml === 0 && !c.roles.length) return false;
    if (region === 'blr' && c.blr === 0) return false;
    if (region === 'remote' && c.remoteIn === 0) return false;
    if (onlyNew && !c.newStartup) return false;
    if (fresh && c.new24h === 0) return false;
    if (q && !`${c.name} ${c.tags.join(' ')} ${c.source} ${c.roles.map((r) => r.title).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a, b) => sort === 'latest' ? Date.parse(b.latest || '1970') - Date.parse(a.latest || '1970')
    : sort === 'name' ? a.name.localeCompare(b.name)
    : sort === 'startup' ? Date.parse(b.fundedAt || b.firstSeen) - Date.parse(a.fundedAt || a.firstSeen)
    : b.fde - a.fde || b.new24h - a.new24h || b.aiml - a.aiml), [d, role, region, onlyNew, fresh, q, sort]);

  if (!d) return <div className="panel muted">Building the company directory…</div>;
  const c = d.counts;
  return (
    <>
      <div className="hero">
        <div>
          <h2>Companies hiring — worldwide</h2>
          <p>Every company the app tracks, with its careers page and the FDE / AI-ML roles open there right now (Bengaluru office or remote-from-India only). Updates itself: jobs re-fetched every ~2 h, new startups (YC hiring + this month’s funding news) found daily and auto-added when they have a role you can take.</p>
          <div className="small" style={{ color: '#fff', opacity: 0.9, marginTop: 6 }}>Jobs refreshed {d.jobsRefreshed ? `${ago(d.jobsRefreshed)} ago` : '—'} · startups scanned {d.startupsScanned ? `${ago(d.startupsScanned)} ago` : '—'}</div>
        </div>
        <div className="hero-stats">
          <div><b>{c.fdeNow}</b><span>with FDE roles now</span></div>
          <div><b>{c.hiringNow}</b><span>hiring FDE/AI</span></div>
          <div><b>{c.new24h}</b><span>new roles in 24 h</span></div>
          <div><b>{c.total}</b><span>companies tracked</span></div>
        </div>
      </div>

      <div className="panel row">
        <span className="seg">{(Object.keys(ROLE_OPTS) as (keyof typeof ROLE_OPTS)[]).map((k) => <button key={k} className={role === k ? 'on' : ''} onClick={() => setRole(k)}>{ROLE_OPTS[k]}</button>)}</span>
        <select value={region} onChange={(e) => setRegion(e.target.value)}><option value="">Bengaluru + remote</option><option value="blr">Bengaluru office only</option><option value="remote">Remote (India OK) only</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="fde">Most FDE roles</option><option value="latest">Latest posting</option><option value="startup">Newest startups</option><option value="name">A–Z</option></select>
        <label className="small"><input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} /> new role in last 24 h</label>
        <label className="small"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> new startups only ({c.newStartups})</label>
        <input className="grow" placeholder="Search company, tag, role…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ExportButton title={`Companies hiring — ${ROLE_OPTS[role]}`} filename={`companies-${role}`}
          subtitle={`${list.length} companies · ${region === 'blr' ? 'Bengaluru office' : region === 'remote' ? 'remote (India OK)' : 'Bengaluru office or remote-from-India'}${fresh ? ' · new role in last 24 h' : ''}${onlyNew ? ' · new startups' : ''}. Generated ${new Date(d.at).toLocaleString('en-IN')}.`}
          cols={[{ header: 'Company', get: (x: Co) => x.name, width: 95 }, { header: 'Careers page', get: (x) => x.careersUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 45), width: 120, link: (x) => x.careersUrl },
            { header: 'FDE', get: (x) => x.fde, width: 28 }, { header: 'AI/ML', get: (x) => x.aiml, width: 32 }, { header: 'BLR', get: (x) => x.blr, width: 28 }, { header: 'Remote', get: (x) => x.remoteIn, width: 36 },
            { header: 'New 24h', get: (x) => x.new24h || '', width: 36 }, { header: 'Latest', get: (x) => (x.latest ? dateLabel(x.latest) : ''), width: 70 },
            { header: 'Open roles', get: (x) => x.roles.slice(0, 4).map((r) => `${r.fde ? '[FDE] ' : ''}${r.title}`).join('; '), link: (x) => x.roles[0]?.url }, { header: 'Source', get: (x) => x.source, width: 90 }]}
          rows={list} />
      </div>

      <div className="small muted" style={{ marginBottom: 8 }}>{list.length} companies · {c.hiresFde} have hired FDEs · {c.blr} with Bengaluru roles · {c.newStartups} new startups</div>
      <div className="grid2">
        {list.slice(0, 300).map((x) => (
          <div key={x.key} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h4 style={{ margin: 0 }}>{x.name}</h4>
              <span className="row" style={{ gap: 4 }}>
                {x.fde > 0 && <span className="badge b-FDE">{x.fde} FDE</span>}
                {x.aiml > 0 && <span className="badge b-AIML">{x.aiml} AI/ML</span>}
                {x.new24h > 0 && <span className="badge b-new">{x.new24h} new · 24h</span>}
              </span>
            </div>
            <div className="small muted">{x.source}{x.ats ? ` · ${x.ats}` : ''}{x.teamSize ? ` · ${x.teamSize} people` : ''}{x.fundedAt ? ` · funded ${dateLabel(x.fundedAt)}` : ''}{x.latest ? ` · latest role ${dateLabel(x.latest)}` : ''}</div>
            <div style={{ marginTop: 4 }}>
              {x.newStartup && <span className="badge b-ok">new startup</span>}
              {x.blr > 0 && <span className="badge b-dom">Bengaluru · {x.blr}</span>}
              {x.remoteIn > 0 && <span className="badge b-dom">Remote India · {x.remoteIn}</span>}
              {x.hiresFde && x.fde === 0 && <span className="badge b-skip">hires FDEs{x.lastFdeSeen ? ` (last seen ${dateLabel(x.lastFdeSeen)})` : ''}</span>}
              {x.tags.slice(0, 3).map((t) => <span key={t} className="badge b-skip">{t}</span>)}
            </div>
            {x.roles.length > 0 && (
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {x.roles.slice(0, 5).map((r) => <li key={r.url} className="small">{r.fde && <b style={{ color: 'var(--accent)' }}>FDE · </b>}<a href={r.url} target="_blank" rel="noreferrer noopener">{r.title}</a> <span className="muted">{r.location}{r.posted ? ` · ${ago(r.posted)} ago` : ''}</span></li>)}
              </ul>
            )}
            <div className="row" style={{ marginTop: 6 }}>
              <a href={x.careersUrl} target="_blank" rel="noreferrer noopener"><button className="primary small-btn">{x.careersKind === 'search' ? 'Find careers page ↗' : 'Careers page ↗'}</button></a>
              {onOutreach && <button className="small-btn" onClick={() => onOutreach(x.name, x.fde ? 'Forward Deployed Engineer' : 'AI Engineer')}>✉ People</button>}
            </div>
          </div>
        ))}
      </div>
      {!list.length && <div className="panel muted">No company matches. Try “All companies” or remove a filter.</div>}
      {d.startupLog.length > 0 && <details className="small muted" style={{ marginTop: 10 }}><summary>Last startup scan</summary><ul>{d.startupLog.map((l) => <li key={l}>{l}</li>)}</ul></details>}
    </>
  );
}
