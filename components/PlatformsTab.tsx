'use client';
import { useEffect, useMemo, useState } from 'react';
import { ago, api } from './api';

type Platform = {
  id: string; name: string; url: string; host: string; mapping: string; connectors: string[];
  searchTemplate: string; kind: string; sheets: string[]; notes: string;
};
type Check = { lastChecked?: string; status?: string; notes?: string };
type Payload = { platforms: Platform[]; checks: Record<string, Check>; live: Record<string, boolean> };

const MAP_LABEL: Record<string, [string, string]> = {
  live_api: ['LIVE · direct API/feed', 'b-ok'],
  live_ats: ['LIVE · company ATS', 'b-ok'],
  aggregated: ['LIVE via aggregator', 'b-warn'],
  deep_link: ['1-click search (no API)', 'b-skip'],
  resource: ['Resource / checklist', 'b-skip'],
  excluded: ['Excluded (defunct)', 'b-err'],
};

export default function PlatformsTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [q, setQ] = useState('');
  const [mapping, setMapping] = useState('');
  const [kind, setKind] = useState('');
  const [kw, setKw] = useState('forward deployed engineer');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    api<Payload>('/api/platforms').then(setD).catch((e) => toast(e.message));
  }, [toast]);

  const kinds = useMemo(() => Array.from(new Set((d?.platforms || []).map((p) => p.kind))).sort(), [d]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (d?.platforms || []).forEach((p) => (c[p.mapping] = (c[p.mapping] || 0) + 1));
    return c;
  }, [d]);

  if (!d) return <div className="panel muted">Loading platforms…</div>;

  const list = d.platforms.filter((p) => {
    if (mapping && p.mapping !== mapping) return false;
    if (kind && p.kind !== kind) return false;
    if (stale) {
      const lc = d.checks[p.id]?.lastChecked;
      if (!['deep_link', 'aggregated'].includes(p.mapping)) return false;
      if (lc && Date.now() - Date.parse(lc) < 3 * 864e5) return false;
    }
    if (q && !`${p.name} ${p.host} ${p.notes} ${p.sheets.join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const searchUrl = (p: Platform) => {
    const t = p.searchTemplate || p.url;
    return t.replace('{q}', encodeURIComponent(kw)).replace('{qslug}', kw.trim().toLowerCase().replace(/\s+/g, '-'));
  };
  const connState = (c: string) => {
    const id = c.split(':')[0];
    return d.live[id];
  };

  async function check(p: Platform, status: string) {
    try {
      const r = await api<{ check: Check }>('/api/platforms', { method: 'POST', body: JSON.stringify({ id: p.id, status }) });
      setD({ ...d!, checks: { ...d!.checks, [p.id]: r.check } });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <div className="stats">
        {Object.entries(MAP_LABEL).map(([k, [l]]) => (
          <div key={k} className="stat" style={{ cursor: 'pointer', outline: mapping === k ? '2px solid var(--accent)' : 'none' }} onClick={() => setMapping(mapping === k ? '' : k)}>
            <b>{counts[k] || 0}</b><span>{l}</span>
          </div>
        ))}
      </div>
      <div className="notice ok small">
        All <b>{d.platforms.length}</b> platforms named in your Excel are mapped here. <b>LIVE</b> ones are pulled automatically into the Jobs tab.
        <b> LIVE via aggregator</b> = no public API, but their postings arrive through Google-Jobs-based APIs (SerpApi / JSearch) or LinkedIn.
        <b> 1-click search</b> = the site has no API and blocks bots — open the pre-filled search and tick “checked” so you know when you last looked.
      </div>
      <div className="panel row">
        <input className="grow" placeholder="Search platforms…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          {kinds.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
        <label className="small">Search keyword for links: <input value={kw} onChange={(e) => setKw(e.target.value)} /></label>
        <label className="small"><input type="checkbox" checked={stale} onChange={(e) => setStale(e.target.checked)} /> due for a manual check (&gt;3 days)</label>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Platform</th><th>How it is tracked</th><th className="hide-sm">Excel sheet(s)</th><th>Last checked</th><th>Action</th></tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const [label, cls] = MAP_LABEL[p.mapping] || [p.mapping, 'b-skip'];
              const c = d.checks[p.id];
              return (
                <tr key={p.id}>
                  <td>
                    <a href={p.url} target="_blank" rel="noreferrer noopener"><b>{p.name}</b></a>
                    <div className="small muted">{p.host} · {p.kind.replace(/_/g, ' ')}</div>
                    {p.notes && <div className="small muted" style={{ maxWidth: 520 }}>{p.notes}</div>}
                  </td>
                  <td>
                    <span className={`badge ${cls}`}>{label}</span>
                    <div>
                      {p.connectors.map((cn) => (
                        <span key={cn} className={`badge ${connState(cn) ? 'b-ok' : 'b-skip'}`} title={connState(cn) ? 'configured' : 'needs API key – see Sources & APIs'}>
                          {cn}{connState(cn) ? '' : ' (key needed)'}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="hide-sm small">{p.sheets.join(', ')}</td>
                  <td className="small">{c?.lastChecked ? `${ago(c.lastChecked)} ago` : '—'}</td>
                  <td>
                    <div className="row">
                      {p.mapping !== 'excluded' && <a href={searchUrl(p)} target="_blank" rel="noreferrer noopener"><button>Open ↗</button></a>}
                      <button onClick={() => check(p, 'checked')}>✓ checked</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
