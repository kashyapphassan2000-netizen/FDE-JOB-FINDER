'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Job } from '@/lib/types';
import { ago, api, dateLabel } from './api';
import ExportButton from './ExportButton';

type D = {
  jobs: Job[]; meta: { lastRefresh: string | null } | null; posts: { id: string; title: string; company: string; author?: string; url: string; postedAt?: string | null; foundAt: string; location: string; applyHow?: string }[];
  funnel: Record<string, number>; outreach: { companies: number; contacts: number; sent: number; replied: number };
  radar: { name: string; date?: string; signal?: string; region?: string; confidence?: string; url?: string }[]; layoffs: { name: string; date?: string; count?: string; reason?: string; next?: string; url?: string; inYourTracker?: boolean }[];
  trends: { skills: { key: string; n: number }[]; roles: { key: string; n: number }[]; regions: { key: string; n: number }[]; yourSkills: { have: string[]; missing: string[]; cvUploaded: boolean } };
  report: { at: string; summary?: string; headlines: { title: string; summary: string; region: string; url: string }[]; moves: string[] } | null;
};
const rank = (t: string[]) => (t.includes('BLR') ? 0 : t.includes('REMOTE_IN') ? 1 : t.includes('UNSTATED') ? 2 : 3);
const WHERE = ['Bengaluru office', 'Remote (India OK)', 'Location not stated', 'India'];

export default function DashboardTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<D | null>(null);
  const [minY, setMinY] = useState(0);
  const [maxY, setMaxY] = useState(6);
  const [role, setRole] = useState<'FDE' | 'ALL'>('FDE');
  const [fresh, setFresh] = useState(30);
  useEffect(() => { api<D>('/api/dashboard').then(setD).catch((e) => toast(e.message)); }, [toast]);

  const recs = useMemo(() => (d?.jobs || [])
    .filter((j) => (role === 'ALL' || j.categories.includes('FDE')) && (!j.exp || (j.exp.max >= minY && j.exp.min <= maxY)) && Date.now() - Date.parse(j.postedAt || j.firstSeen) < fresh * 864e5 && !(j.flags || []).some((f) => f.startsWith('⚠')))
    .sort((a, b) => rank(a.locTags) - rank(b.locTags) || (b.score + b.cvMatch) - (a.score + a.cvMatch)), [d, minY, maxY, role, fresh]);
  if (!d) return <div className="panel muted">Building your dashboard…</div>;
  const blr = recs.filter((j) => j.locTags.includes('BLR')).length;
  const rem = recs.filter((j) => !j.locTags.includes('BLR') && j.locTags.includes('REMOTE_IN')).length;
  const fde = d.jobs.filter((j) => j.categories.includes('FDE')).length;
  const why = (j: Job) => [j.locTags.includes('BLR') ? 'Bengaluru' : j.locTags.includes('REMOTE_IN') ? 'remote, India OK' : '', j.hidden ? 'low competition' : '', j.cvMatch >= 40 ? `${j.cvMatch}% CV fit` : '', j.salary ? 'pay shown' : j.payBand ? `est. ${j.payBand}` : '', Date.now() - Date.parse(j.postedAt || j.firstSeen) < 2 * 864e5 ? 'fresh (<48h)' : ''].filter(Boolean).join(' · ');

  const sections = [
    { title: 'Summary', text: `${d.jobs.length} jobs tracked (${fde} FDE). Recommendations for ${role === 'FDE' ? 'FDE' : 'FDE + AI/ML'} roles, ${minY}-${maxY} years experience, posted in the last ${fresh} days: ${recs.length} (${blr} Bengaluru, ${rem} remote). Applications: ${Object.entries(d.funnel).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'}. Outreach: ${d.outreach.sent} emails sent, ${d.outreach.replied} replies.` },
    { title: 'Layoffs to watch', headers: ['Company', 'Date', 'Cuts', 'Why', 'Next', 'In your tracker', 'Link'], rows: d.layoffs.map((l) => [l.name, l.date || '', l.count || '', l.reason || '', l.next || '', l.inYourTracker ? 'YES' : '', l.url || '']) },
    { title: 'Skills employers ask for', text: d.trends.skills.map((s) => `${s.key} (${s.n})`).join(', ') + (d.trends.yourSkills.cvUploaded ? `\nMissing from your CV: ${d.trends.yourSkills.missing.join(', ')}` : '') },
    ...(d.report ? [{ title: 'Market this week', text: d.report.summary || '' }, { title: 'Market headlines', headers: ['Region', 'Headline', 'Summary', 'Link'], rows: d.report.headlines.map((h) => [h.region, h.title, h.summary, h.url]) }, { title: 'Your next moves', text: d.report.moves.map((m, i) => `${i + 1}. ${m}`).join('\n') }] : []),
    { title: 'Latest hiring posts (communities)', headers: ['Role', 'Author / company', 'Posted', 'How to apply', 'Link'], rows: d.posts.slice(0, 25).map((p) => [p.title, p.author || p.company, (p.postedAt || p.foundAt).slice(0, 10), p.applyHow || '', p.url]) },
  ];

  return (
    <>
      <div className="hero">
        <div>
          <h2>Your FDE command centre</h2>
          <p>Everything the app collected, filtered to what you can actually take — Bengaluru office first, then remote open to India — with a full analysis. {d.meta?.lastRefresh ? `Jobs updated ${ago(d.meta.lastRefresh)}.` : ''}</p>
        </div>
        <div className="hero-stats">
          <div><b>{recs.length}</b><span>recommended</span></div>
          <div><b>{blr}</b><span>Bengaluru</span></div>
          <div><b>{rem}</b><span>remote</span></div>
        </div>
      </div>
      <div className="panel row">
        <span className="seg"><button className={role === 'FDE' ? 'on' : ''} onClick={() => setRole('FDE')}>FDE only</button><button className={role === 'ALL' ? 'on' : ''} onClick={() => setRole('ALL')}>FDE + AI/ML</button></span>
        <label className="small">Experience from <select value={minY} onChange={(e) => setMinY(+e.target.value)}>{[0, 1, 2, 3, 4, 5, 6, 8, 10].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="small">to <select value={maxY} onChange={(e) => setMaxY(+e.target.value)}>{[1, 2, 3, 4, 5, 6, 8, 10, 15, 30].map((y) => <option key={y} value={y}>{y === 30 ? 'any' : y}</option>)}</select> years</label>
        <label className="small">posted within <select value={fresh} onChange={(e) => setFresh(+e.target.value)}>{[1, 3, 7, 14, 30, 90].map((x) => <option key={x} value={x}>{x} days</option>)}</select></label>
        <span style={{ marginLeft: 'auto' }}>
          <ExportButton title="My dashboard — FDE recommendations & analysis" subtitle={`${role === 'FDE' ? 'FDE' : 'FDE + AI/ML'} · ${minY}-${maxY === 30 ? 'any' : maxY} years · last ${fresh} days · Bengaluru first, then remote`} sections={sections}
            cols={[
              { header: '#', get: (j: Job) => recs.indexOf(j) + 1, width: 22 },
              { header: 'Role', get: (j: Job) => j.title, width: 160, link: (j: Job) => j.url },
              { header: 'Company', get: (j: Job) => j.company, width: 95 },
              { header: 'Where', get: (j: Job) => WHERE[rank(j.locTags)], width: 70 },
              { header: 'Exp', get: (j: Job) => (j.exp ? `${j.exp.min}-${j.exp.max}${j.exp.estimated ? '*' : ''}` : ''), width: 40 },
              { header: 'Why', get: (j: Job) => why(j), width: 150 },
              { header: 'Posted', get: (j: Job) => (j.postedAt || j.firstSeen).slice(0, 10), width: 55 },
              { header: 'Apply', get: (j: Job) => j.url, link: (j: Job) => j.url },
            ]} rows={recs} />
        </span>
      </div>

      <div className="stats">
        {Object.entries({ saved: 'saved', applied: 'applied', referral: 'referral', interview: 'interviews', offer: 'offers' }).map(([k, l]) => <div key={k} className="stat"><b>{d.funnel[k] || 0}</b><span>{l}</span></div>)}
        <div className="stat"><b>{d.outreach.sent}</b><span>emails sent · {d.outreach.replied} replies</span></div>
      </div>

      <div className="grid2">
        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ marginTop: 0 }}>🎯 Recommended for you ({recs.length})</h3>
          {[0, 1, 2].map((r) => {
            const list = recs.filter((j) => rank(j.locTags) === r).slice(0, r === 0 ? 25 : 15);
            if (!list.length) return null;
            return (
              <div key={r} style={{ marginBottom: 12 }}>
                <div className="small muted" style={{ margin: '6px 0' }}><b>{WHERE[r]}</b> · {recs.filter((j) => rank(j.locTags) === r).length}</div>
                {list.map((j) => (
                  <div key={j.id} className="tline row" style={{ justifyContent: 'space-between' }}>
                    <span><a href={j.url} target="_blank" rel="noreferrer"><b>{j.title}</b></a> <span className="muted small">· {j.company}{j.exp ? ` · ${j.exp.min}–${j.exp.max} yrs${j.exp.estimated ? '*' : ''}` : ''}</span><div className="small muted">{why(j)}</div></span>
                    <a className="btn primary small-btn" href={j.url} target="_blank" rel="noreferrer">Apply</a>
                  </div>
                ))}
              </div>
            );
          })}
          {!recs.length && <div className="empty small">Nothing in this range — widen the years or the date window.</div>}
          <div className="small muted">* experience estimated from seniority when the post doesn’t say.</div>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>📉 Layoffs to watch</h3>
          {d.layoffs.map((l) => <div key={l.name} className="tline"><b>{l.name}</b> {l.date && <span className="badge b-date">{dateLabel(l.date)}</span>} {l.inYourTracker && <span className="badge b-err">in your tracker</span>}<div className="small muted">{l.count} · {l.reason} {l.url && <a href={l.url} target="_blank" rel="noreferrer">source</a>}</div></div>)}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>🧠 What employers ask for</h3>
          <div className="row">{d.trends.skills.map((s) => <span key={s.key} className={`badge ${d.trends.yourSkills.have.includes(s.key) ? 'b-ok' : 'b-dom'}`}>{s.key} · {s.n}</span>)}</div>
          {d.trends.yourSkills.cvUploaded ? <p className="small">Missing from your CV: {d.trends.yourSkills.missing.map((m) => <span key={m} className="badge b-err">{m}</span>)}</p> : <p className="small muted">Upload your CV to see your gaps.</p>}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>📣 Latest hiring posts</h3>
          {d.posts.slice(0, 10).map((p) => <div key={p.id} className="tline"><a href={p.url} target="_blank" rel="noreferrer"><b>{p.title}</b></a> <span className="small muted">· {p.author || p.company} · {ago(p.postedAt || p.foundAt)}</span>{p.applyHow && <div className="small apply-how">➜ {p.applyHow}</div>}</div>)}
        </div>
        {d.report && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <h3 style={{ marginTop: 0 }}>📰 Market headlines</h3>
            {d.report.headlines.map((h) => <div key={h.url} className="tline"><span className="badge b-dom">{h.region}</span> <a href={h.url} target="_blank" rel="noreferrer"><b>{h.title}</b></a><div className="small muted">{h.summary}</div></div>)}
            {d.report.moves.length > 0 && <div className="notice ok small" style={{ marginTop: 8 }}><b>Your next moves:</b> {d.report.moves.join(' · ')}</div>}
          </div>
        )}
      </div>
    </>
  );
}
