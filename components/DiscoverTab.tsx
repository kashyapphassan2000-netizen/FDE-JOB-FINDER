'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, api, dateLabel, isStale } from './api';
import ExportButton from './ExportButton';

type Co = {
  key: string; name: string; website?: string; location: string; region: string[]; source: string; sourceUrl?: string; tags: string[];
  teamSize?: number; stage?: string; fundingNews?: string; fundedAt?: string; ats?: { ats: string; slug: string; total: number }; ycSlug?: string;
  roles: { title: string; location: string; url: string }[]; hiddenScore: number; checkedAt: string; status: 'new' | 'watched' | 'dismissed';
};

export default function DiscoverTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<{ companies: Co[]; meta: { at: string; log: string[] } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState('');
  const [onlyRoles, setOnlyRoles] = useState(true);
  const [src, setSrc] = useState('');
  const [status, setStatus] = useState('new');
  const [q, setQ] = useState('');

  const auto = useRef(false);
  const load = useCallback(() => api<{ companies: Co[]; meta: { at: string; log: string[] } | null }>('/api/discover').then((x) => { setD(x); return x; }).catch((e) => { toast(e.message); return null; }), [toast]);
  useEffect(() => {
    load().then((x) => {
      if (!x || auto.current) return;
      auto.current = true;
      if (isStale(x.meta?.at, 24)) scan(true); // fresh on open
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function scan(silent = false) {
    setBusy(true);
    if (!silent) toast('Scanning YC hiring companies + this week’s funding news, then checking each one’s careers board (2–4 min)…');
    try {
      const r = await api<{ added: number; checked: number; total: number }>('/api/discover', { method: 'POST', body: JSON.stringify({ action: 'run' }) });
      toast(`Checked ${r.checked} companies · ${r.added} new · ${r.total} in your list`);
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(c: Co, action: 'watch' | 'dismiss' | 'new') {
    const r = await api<{ note?: string }>('/api/discover', { method: 'POST', body: JSON.stringify({ action, key: c.key }) });
    toast(r.note || (action === 'watch' ? `Watching ${c.name}${c.ats ? ' — its jobs now flow into the Jobs tab' : ''}` : 'Updated'));
    load();
  }

  const list = useMemo(() => (d?.companies || []).filter((c) =>
    (status === 'all' || c.status === status) && (!region || c.region.includes(region)) && (!onlyRoles || c.roles.length > 0) &&
    (!src || (src === 'yc' ? c.source.startsWith('YC') : c.source.startsWith('Funding'))) &&
    (!q || `${c.name} ${c.tags.join(' ')} ${c.location}`.toLowerCase().includes(q.toLowerCase()))), [d, region, onlyRoles, src, status, q]);

  if (!d) return <div className="panel muted">Loading…</div>;
  return (
    <>
      <div className="notice ok small">
        <b>Hidden jobs = low-crowd companies.</b> Fresh only: funding news from the last 30 days (feeds + Google/Bing News) and every company re-checked at least every 14 days — stale ones disappear. Freshly funded startups (India + US funding news) and YC companies that are hiring in Bengaluru / India / remote / USA.
        For each one the app finds its public careers board and lists open <b>FDE / AI-ML</b> roles. <b>Watch</b> = poll it on every refresh. Auto-scan runs daily.
      </div>
      <div className="panel row">
        <button className="primary" disabled={busy} onClick={() => scan()}>{busy ? 'Scanning fresh data…' : '🔄 Scan now'}</button>
        <span className="small muted">{busy ? 'getting the latest…' : d.meta ? `updated ${ago(d.meta.at)} ago · auto daily + when older than 24 h` : 'never scanned'}</span>
        <ExportButton title="Hidden jobs & new startups" subtitle={`Funding news from the last 30 days; companies re-checked within 14 days. Updated ${d.meta ? new Date(d.meta.at).toLocaleString('en-IN') : 'never'}.`} filename="hidden-jobs-startups"
          cols={[{ header: 'Company', get: (c: Co) => c.name, width: 90, link: (c: Co) => c.website }, { header: 'Score', get: (c) => c.hiddenScore, width: 34 }, { header: 'Location', get: (c) => c.location, width: 90 },
            { header: 'Source', get: (c) => `${c.source}${c.fundedAt ? ` (${dateLabel(c.fundedAt)})` : ''}`, width: 90, link: (c) => c.sourceUrl }, { header: 'Funding', get: (c) => c.fundingNews || '', width: 150 },
            { header: 'Open FDE/AI roles', get: (c) => c.roles.map((r) => `${r.title} — ${r.location}`).join('; '), link: (c) => c.roles[0]?.url }, { header: 'Checked', get: (c) => dateLabel(c.checkedAt), width: 60 }]}
          rows={list} />
        <input placeholder="Search name / tag…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Anywhere</option><option value="BLR">Bengaluru</option><option value="INDIA">India</option><option value="USA">USA</option><option value="REMOTE">Remote</option>
        </select>
        <select value={src} onChange={(e) => setSrc(e.target.value)}><option value="">All sources</option><option value="yc">YC companies</option><option value="fund">Recently funded</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="new">New</option><option value="watched">Watched</option><option value="dismissed">Dismissed</option><option value="all">All</option></select>
        <label className="small"><input type="checkbox" checked={onlyRoles} onChange={(e) => setOnlyRoles(e.target.checked)} /> only with open FDE/AI roles</label>
      </div>
      <div className="small muted" style={{ marginBottom: 6 }}>{list.length} companies</div>
      <div className="grid2">
        {list.slice(0, 200).map((c) => (
          <div key={c.key} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h4 style={{ margin: 0 }}>{c.website ? <a href={c.website} target="_blank" rel="noreferrer noopener">{c.name}</a> : c.name}</h4>
              <span className="score" title="hidden-gem score">{c.hiddenScore}</span>
            </div>
            <div className="small muted">{c.location || '—'} · {c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener">{c.source}</a> : c.source}{c.teamSize ? ` · ${c.teamSize} people` : ''}{c.stage ? ` · ${c.stage}` : ''}</div>
            {c.fundingNews && <div className="small" style={{ marginTop: 4 }}>💰 {c.fundingNews} {c.fundedAt && <span className="badge b-date">{dateLabel(c.fundedAt)}</span>}</div>}
            <div style={{ marginTop: 4 }}>{c.tags.slice(0, 5).map((t) => <span key={t} className="badge b-dom">{t}</span>)}{c.ats && <span className="badge b-AIML">{c.ats.ats} · {c.ats.total} jobs</span>}</div>
            {c.roles.length > 0 && (
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {c.roles.slice(0, 5).map((r) => <li key={r.url} className="small"><a href={r.url} target="_blank" rel="noreferrer noopener">{r.title}</a> <span className="muted">{r.location}</span></li>)}
              </ul>
            )}
            <div className="row" style={{ marginTop: 6 }}>
              {c.status !== 'watched' && <button className="primary small-btn" onClick={() => act(c, 'watch')}>Watch</button>}
              {c.status !== 'dismissed' ? <button className="small-btn" onClick={() => act(c, 'dismiss')}>Dismiss</button> : <button className="small-btn" onClick={() => act(c, 'new')}>Restore</button>}
              {c.ycSlug && <a href={`https://www.ycombinator.com/companies/${c.ycSlug}/jobs`} target="_blank" rel="noreferrer noopener"><button className="small-btn">YC jobs ↗</button></a>}
              <span className="small muted">checked {ago(c.checkedAt)} ago</span>
            </div>
          </div>
        ))}
      </div>
      {!list.length && <div className="panel muted">Nothing here yet — click <b>Scan now</b>{onlyRoles ? ' or untick “only with open FDE/AI roles”' : ''}.</div>}
    </>
  );
}
