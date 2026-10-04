'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Category, Domain, Job, TrackStatus } from '@/lib/types';
import { ago, setTrack, STATUS_LABEL, type JobsPayload } from './api';
import FitDrawer from './FitDrawer';

const ROLES: [Category, string][] = [['FDE', 'FDE'], ['AIML', 'AI / ML']];
export const DOMAINS: [Domain, string][] = [
  ['AI_LAB', 'Frontier AI lab'], ['AI_INFRA', 'AI infra / devtools'], ['SEMI', 'Semiconductor'], ['EMBEDDED', 'Embedded / Robotics / Auto'],
  ['IT', 'IT / SaaS'], ['FINTECH', 'Fintech'], ['HEALTH', 'Health'], ['DEFENSE', 'Defense'], ['CONSULTING', 'Consulting'],
];
const REGIONS = [['BLR', 'Bengaluru'], ['INDIA', 'India'], ['USA', 'USA'], ['REMOTE_IN', 'Remote · India-eligible'], ['REMOTE', 'Remote (any)'], ['GLOBAL', 'Other onsite']] as const;
const WINDOWS = [['24', '24h'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days'], ['0', 'Any time']] as const;
const DOMAIN_LABEL = Object.fromEntries(DOMAINS) as Record<Domain, string>;

export default function JobsTab({ data, reload, toast }: { data: JobsPayload | null; reload: () => void; toast: (s: string) => void }) {
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState<Category[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [win, setWin] = useState('168');
  const [src, setSrc] = useState('');
  const [sen, setSen] = useState('');
  const [sort, setSort] = useState<'score' | 'new' | 'cv'>('score');
  const [hideTracked, setHideTracked] = useState(true);
  const [onlyNew, setOnlyNew] = useState(false);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [salaryOnly, setSalaryOnly] = useState(false);
  const [limit, setLimit] = useState(100);
  const [lastVisit, setLastVisit] = useState<number>(0);
  const [fit, setFit] = useState<Job | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem('fj_filters2') || '{}');
      if (f.roles) setRoles(f.roles);
      if (f.domains) setDomains(f.domains);
      if (f.regions) setRegions(f.regions);
      if (f.win) setWin(f.win);
      if (f.sort) setSort(f.sort);
      if (f.sen) setSen(f.sen);
      setLastVisit(Number(localStorage.getItem('fj_lastVisit') || 0));
      localStorage.setItem('fj_lastVisit', String(Date.now()));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('fj_filters2', JSON.stringify({ roles, domains, regions, win, sort, sen })); } catch {}
  }, [roles, domains, regions, win, sort, sen]);

  const jobs = data?.jobs || [];
  const track = data?.track || {};
  const sources = useMemo(() => Array.from(new Set(jobs.flatMap((j) => j.sources))).sort(), [jobs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const maxH = Number(win);
    let out = jobs.filter((j) => {
      if (hideTracked && track[j.id]) return false;
      if (roles.length && !roles.some((c) => j.categories.includes(c))) return false;
      if (domains.length && !domains.includes(j.domain)) return false;
      if (regions.length && !regions.some((l) => j.locTags.includes(l))) return false;
      if (src && !j.sources.includes(src)) return false;
      if (sen && j.seniority !== sen) return false;
      if (hiddenOnly && !j.hidden) return false;
      if (salaryOnly && !j.salary) return false;
      if (maxH && Date.now() - Date.parse(j.postedAt || j.firstSeen) > maxH * 36e5) return false;
      if (onlyNew && lastVisit && Date.parse(j.firstSeen) < lastVisit) return false;
      if (needle && !`${j.title} ${j.company} ${j.location} ${j.via || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === 'new') out = [...out].sort((a, b) => Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
    if (sort === 'cv') out = [...out].sort((a, b) => b.cvMatch - a.cvMatch || b.score - a.score);
    return out;
  }, [jobs, track, q, roles, domains, regions, win, src, sen, sort, hideTracked, onlyNew, lastVisit, hiddenOnly, salaryOnly]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { new24: 0, hidden: 0 };
    for (const j of jobs) {
      [...j.categories, ...j.locTags, j.domain].forEach((x) => (c[x] = (c[x] || 0) + 1));
      if (j.hidden) c.hidden++;
      if (Date.now() - Date.parse(j.firstSeen) < 864e5) c.new24++;
    }
    return c;
  }, [jobs]);

  const toggle = <T,>(arr: T[], v: T, set: (a: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const clear = () => { setRoles([]); setDomains([]); setRegions([]); setSrc(''); setSen(''); setHiddenOnly(false); setSalaryOnly(false); setQ(''); setWin('168'); };

  async function mark(job: Job, status: TrackStatus | 'none') {
    try {
      await setTrack(job, status);
      toast(status === 'none' ? 'Removed from tracker' : `Marked: ${STATUS_LABEL[status as TrackStatus]}`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (!data) return <div className="panel muted">Loading…</div>;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{jobs.length}</b><span>FDE + AI/ML jobs tracked</span></div>
        <div className="stat"><b>{counts.new24}</b><span>new in last 24h</span></div>
        <div className="stat"><b>{counts.FDE || 0}</b><span>FDE roles</span></div>
        <div className="stat"><b>{counts.BLR || 0}</b><span>in Bengaluru</span></div>
        <div className="stat"><b>{counts.REMOTE_IN || 0}</b><span>remote, India-eligible</span></div>
        <div className="stat"><b>{counts.USA || 0}</b><span>USA</span></div>
        <div className="stat"><b>{counts.hidden}</b><span>hidden gems (low-crowd)</span></div>
      </div>

      {!jobs.length && <div className="notice warn">No jobs yet. Click <b>⟳ Refresh now</b> (top right). First run takes 30–90 seconds.</div>}

      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="grow" placeholder="Search title, company, location…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={win} onChange={(e) => setWin(e.target.value)}>{WINDOWS.map(([v, l]) => <option key={v} value={v}>Posted: {l}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="score">Sort: best match</option><option value="new">Sort: newest</option><option value="cv">Sort: CV match</option>
          </select>
          <button onClick={() => setShowFilters(!showFilters)}>{showFilters ? 'Hide filters' : 'Filters'}</button>
          <button onClick={clear}>Clear</button>
        </div>
        {showFilters && (
          <>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="small muted fl">Role</span>
              {ROLES.map(([v, l]) => <span key={v} className={`chip ${roles.includes(v) ? 'on' : ''}`} onClick={() => toggle(roles, v, setRoles)}>{l} · {counts[v] || 0}</span>)}
            </div>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="small muted fl">Where</span>
              {REGIONS.map(([v, l]) => <span key={v} className={`chip ${regions.includes(v) ? 'on' : ''}`} onClick={() => toggle(regions, v as string, setRegions)}>{l} · {counts[v] || 0}</span>)}
            </div>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="small muted fl">Domain</span>
              {DOMAINS.map(([v, l]) => <span key={v} className={`chip ${domains.includes(v) ? 'on' : ''}`} onClick={() => toggle(domains, v, setDomains)}>{l} · {counts[v] || 0}</span>)}
            </div>
            <div className="row">
              <span className="small muted fl">More</span>
              <select value={sen} onChange={(e) => setSen(e.target.value)}>
                <option value="">Any level</option><option value="junior">Junior / entry</option><option value="mid">Mid</option><option value="senior">Senior / lead</option>
              </select>
              <select value={src} onChange={(e) => setSrc(e.target.value)}>
                <option value="">All sources</option>{sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <label className="small"><input type="checkbox" checked={hiddenOnly} onChange={(e) => setHiddenOnly(e.target.checked)} /> hidden gems only</label>
              <label className="small"><input type="checkbox" checked={salaryOnly} onChange={(e) => setSalaryOnly(e.target.checked)} /> salary shown</label>
              <label className="small"><input type="checkbox" checked={hideTracked} onChange={(e) => setHideTracked(e.target.checked)} /> hide tracked</label>
              <label className="small"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> new since last visit</label>
            </div>
          </>
        )}
      </div>

      <div className="muted small" style={{ marginBottom: 6 }}>{filtered.length} matching</div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Score</th><th>Role</th><th>Company</th><th className="hide-sm">Location</th><th>Posted</th><th className="hide-sm">Source</th><th className="hide-sm">CV</th><th>Action</th></tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((j) => {
              const isNew = lastVisit && Date.parse(j.firstSeen) >= lastVisit;
              return (
                <tr key={j.id}>
                  <td className="score">{j.score}</td>
                  <td className="title">
                    <a href={j.url} target="_blank" rel="noreferrer noopener">{j.title}</a> {isNew ? <span className="badge b-new">NEW</span> : null}
                    <div>
                      {j.categories.map((c) => <span key={c} className={`badge b-${c}`}>{c === 'AIML' ? 'AI/ML' : 'FDE'}</span>)}
                      {j.domain && <span className="badge b-dom">{DOMAIN_LABEL[j.domain] || j.domain}</span>}
                      {j.locTags.includes('REMOTE_IN') && <span className="badge b-ok">remote · India OK</span>}
                      {j.hidden && <span className="badge b-SEMI">hidden gem</span>}
                      {j.salary && <span className="badge b-skip">{j.salary}</span>}
                    </div>
                  </td>
                  <td>{j.company}</td>
                  <td className="hide-sm small">{j.location || '—'}</td>
                  <td className="small" title={j.postedAt || `first seen ${j.firstSeen}`}>{ago(j.postedAt || j.firstSeen)}</td>
                  <td className="hide-sm small">{j.sources.join(', ')}{j.via ? <div className="muted">via {j.via}</div> : null}</td>
                  <td className="hide-sm small">{j.cvMatch ? `${j.cvMatch}%` : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <a href={j.url} target="_blank" rel="noreferrer noopener"><button className="primary small-btn">Apply</button></a>
                      <button className="small-btn" title="AI fit check vs your CV" onClick={() => setFit(j)}>AI</button>
                    </div>
                    <select style={{ marginTop: 4 }} value={track[j.id]?.status || ''} onChange={(e) => mark(j, (e.target.value || 'none') as TrackStatus | 'none')}>
                      <option value="">Track…</option>
                      {(Object.keys(STATUS_LABEL) as TrackStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={() => setLimit(limit + 200)}>Show more ({filtered.length - limit} left)</button></div>}
      {fit && <FitDrawer job={fit} onClose={() => setFit(null)} onApplied={() => { mark(fit, 'applied'); setFit(null); }} />}
    </>
  );
}
