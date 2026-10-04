'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api, dateLabel } from './api';
import ExportButton from './ExportButton';

type Opp = { id: string; kind: 'hackathon' | 'hiring_challenge' | 'contract'; title: string; org: string; url: string; deadline?: string | null; posted?: string | null; prize?: string; eligibility: string; openToYou: boolean; tags: string[]; ppi?: boolean; pay?: string };
type Payload = { at: string; items: Opp[]; errors: string[]; programs: { group: string; items: { name: string; what: string; url: string; note?: string }[] }[] };

const KIND: Record<Opp['kind'], string> = { hiring_challenge: '🎯 Hiring challenge', hackathon: '🏆 Hackathon', contract: '💵 Remote AI contract' };
const left = (iso?: string | null) => {
  if (!iso) return '';
  const d = Math.ceil((Date.parse(iso) - Date.now()) / 864e5);
  return d < 0 ? 'closed' : d === 0 ? 'closes today' : `${d} days left`;
};

export default function OpportunitiesTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [kind, setKind] = useState<'' | Opp['kind']>('');
  const [onlyMine, setOnlyMine] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback((force = false) => { setBusy(true); return api<Payload>(`/api/opportunities${force ? '?force=1' : ''}`).then(setD).catch((e) => toast(e.message)).finally(() => setBusy(false)); }, [toast]);
  useEffect(() => { load(); }, [load]);
  const items = useMemo(() => (d?.items || []).filter((o) => (!kind || o.kind === kind) && (!onlyMine || o.openToYou)).sort((a, b) => Number(b.ppi || 0) - Number(a.ppi || 0) || (a.kind === 'contract' ? 1 : 0) - (b.kind === 'contract' ? 1 : 0) || Date.parse(a.deadline || '2100-01-01') - Date.parse(b.deadline || '2100-01-01')), [d, kind, onlyMine]);
  if (!d) return <div className="panel muted">Loading opportunities…</div>;
  const n = (k: Opp['kind']) => d.items.filter((o) => o.kind === k && (!onlyMine || o.openToYou)).length;
  return (
    <>
      <div className="hero">
        <div>
          <h2>Side doors into a job</h2>
          <p>Hiring challenges and hackathons (winners get pre-placement interviews), remote AI contracts that convert to full-time, open-source programs and inbound channels — all from your Excel, with live listings refreshed every 3 hours; closed and old ones are removed.</p>
        </div>
        <div className="hero-stats">
          <div><b>{n('hiring_challenge') + n('hackathon')}</b><span>challenges open</span></div>
          <div><b>{n('contract')}</b><span>AI contracts</span></div>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="seg">
          <button className={!kind ? 'on' : ''} onClick={() => setKind('')}>All</button>
          {(Object.keys(KIND) as Opp['kind'][]).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND[k]} · {n(k)}</button>)}
        </span>
        <label className="small"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> only ones open to working professionals / online</label>
        <span className="small muted">updated {ago(d.at)}</span>
        <button className="small-btn" disabled={busy} onClick={() => load(true)}>{busy ? 'Refreshing…' : '🔄 Refresh now'}</button>
        <ExportButton title="Opportunities — challenges, hackathons, AI contracts" subtitle={`Live listings (closed / old ones removed). Updated ${new Date(d.at).toLocaleString('en-IN')}.`} filename="opportunities"
          cols={[{ header: 'Type', get: (o: Opp) => KIND[o.kind].replace(/^\S+\s/, ''), width: 80 }, { header: 'Title', get: (o) => o.title, link: (o) => o.url }, { header: 'Org', get: (o) => o.org, width: 90 },
            { header: 'Pay / prize', get: (o) => o.pay || o.prize || '', width: 70 }, { header: 'Deadline', get: (o) => (o.deadline ? `${dateLabel(o.deadline).split(' ·')[0]} (${left(o.deadline)})` : ''), width: 80 },
            { header: 'Posted', get: (o) => dateLabel(o.posted), width: 70 }, { header: 'PPO/interview', get: (o) => (o.ppi ? 'yes' : ''), width: 50 }, { header: 'Eligibility', get: (o) => o.eligibility, width: 140 }]}
          tableFirst rows={items} sections={d.programs.map((g) => ({ title: g.group, headers: ['Name', 'What', 'Link'], rows: g.items.map((p) => [p.name, p.what, p.url]) }))} />
      </div>
      {d.errors.length > 0 && <div className="notice warn small">{d.errors.join(' · ')}</div>}
      <div className="opps">
        {items.slice(0, 200).map((o) => (
          <a key={o.id} className="opp" href={o.url} target="_blank" rel="noreferrer">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className={`kind ${o.kind === 'contract' ? 'k-job' : o.kind === 'hiring_challenge' ? 'k-post' : 'k-company'}`}>{KIND[o.kind]}</span>
              {o.ppi && <span className="badge b-ok">interview / PPO for winners</span>}
            </div>
            <div className="opp-title">{o.title}</div>
            <div className="small muted">{o.org}</div>
            <div className="row small" style={{ marginTop: 6, gap: 6 }}>
              {o.pay && <span className="badge b-money">{o.pay}</span>}
              {o.prize && <span className="badge b-money">{o.prize}</span>}
              {o.deadline && <span className="badge b-warn">{left(o.deadline)}</span>}
              {o.posted && !o.deadline && <span className="badge b-skip">posted {ago(o.posted)}</span>}
              {o.tags.slice(0, 2).map((t) => <span key={t} className="badge b-dom">{t}</span>)}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>{o.eligibility}</div>
          </a>
        ))}
        {!items.length && <div className="empty">Nothing open right now for this filter.</div>}
      </div>
      {d.programs.map((g) => (
        <div key={g.group} className="panel">
          <h3>{g.group}</h3>
          <div className="grid2">
            {g.items.map((p) => (
              <a key={p.name} className="card" href={p.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                <h4>{p.name} ↗</h4>
                <div className="small muted">{p.what}</div>
                {p.note && <span className="badge b-ok" style={{ marginTop: 4 }}>{p.note}</span>}
              </a>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
