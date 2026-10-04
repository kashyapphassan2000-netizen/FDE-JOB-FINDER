'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Category, Domain, Job, TrackStatus } from '@/lib/types';
import { ago, setTrack, STATUS_LABEL, type JobsPayload } from './api';
import FitDrawer from './FitDrawer';
import ExportButton from './ExportButton';

const rank = (tags: string[]) => (tags.includes('BLR') ? 0 : tags.includes('REMOTE_IN') ? 1 : tags.includes('UNSTATED') ? 2 : 3);
const EXP = [['', 'Any experience'], ['0-2', '0–2 yrs'], ['2-5', '2–5 yrs'], ['3-6', '3–6 yrs'], ['5-8', '5–8 yrs'], ['8-30', '8+ yrs']] as const;

const ROLES: [Category, string][] = [['FDE', 'FDE'], ['AIML', 'AI / ML']];
export const DOMAINS: [Domain, string][] = [
  ['AI_LAB', 'Frontier AI lab'], ['AI_INFRA', 'AI infra / devtools'], ['SEMI', 'Semiconductor'], ['EMBEDDED', 'Embedded / Robotics / Auto'],
  ['IT', 'IT / SaaS'], ['FINTECH', 'Fintech'], ['HEALTH', 'Health'], ['DEFENSE', 'Defense'], ['CONSULTING', 'Consulting'],
];
const REGIONS = [['BLR', 'Bengaluru office'], ['REMOTE_IN', 'Remote · India-eligible'], ['UNSTATED', 'Location not stated']] as const;
const WINDOWS = [['24', '24h'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days'], ['0', 'Any time']] as const;
const DOMAIN_LABEL = Object.fromEntries(DOMAINS) as Record<Domain, string>;

export default function JobsTab({ data, reload, toast, onOutreach }: { data: JobsPayload | null; reload: () => void; toast: (s: string) => void; onOutreach?: (company: string, role: string) => void }) {
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState<Category[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [win, setWin] = useState('24');
  const [src, setSrc] = useState('');
  const [sen, setSen] = useState('');
  const [sort, setSort] = useState<'blr' | 'score' | 'new' | 'cv'>('blr');
  const [exp, setExp] = useState('');
  const [hideTracked, setHideTracked] = useState(true);
  const [onlyNew, setOnlyNew] = useState(false);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [salaryOnly, setSalaryOnly] = useState(false);
  const [limit, setLimit] = useState(100);
  const [lastVisit, setLastVisit] = useState<number>(0);
  const [fit, setFit] = useState<Job | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  useEffect(() => { if (window.innerWidth < 900) setShowFilters(false); }, []);

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem('fj_filters4') || '{}');
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
    try { localStorage.setItem('fj_filters4', JSON.stringify({ roles, domains, regions, win, sort, sen })); } catch {}
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
      if (exp && j.exp) { const [a, b] = exp.split('-').map(Number); if (j.exp.max < a || j.exp.min > b) return false; }
      if (needle && !`${j.title} ${j.company} ${j.location} ${j.via || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === 'blr') out = [...out].sort((a, b) => rank(a.locTags) - rank(b.locTags) || Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
    if (sort === 'new') out = [...out].sort((a, b) => Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
    if (sort === 'cv') out = [...out].sort((a, b) => b.cvMatch - a.cvMatch || b.score - a.score);
    return out;
  }, [jobs, track, q, roles, domains, regions, win, src, sen, sort, hideTracked, onlyNew, lastVisit, hiddenOnly, salaryOnly, exp]);

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
  const clear = () => { setRoles([]); setDomains([]); setRegions([]); setSrc(''); setSen(''); setHiddenOnly(false); setSalaryOnly(false); setQ(''); setWin('24'); };

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
        <div className="stat"><b>{jobs.length}</b><span>FDE + AI/ML jobs</span></div>
        <div className="stat hot"><b>{counts.new24}</b><span>new in last 24 h</span></div>
        <div className="stat"><b>{counts.BLR || 0}</b><span>Bengaluru office</span></div>
        <div className="stat"><b>{counts.REMOTE_IN || 0}</b><span>remote, open to India</span></div>
        <div className="stat"><b>{counts.FDE || 0}</b><span>FDE roles</span></div>
        <div className="stat"><b>{counts.hidden}</b><span>hidden gems</span></div>
      </div>

      {!jobs.length && <div className="notice warn">No jobs yet. Click <b>⟳ Refresh now</b> (top right). First run takes 30–90 seconds.</div>}

      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="grow" placeholder="Search title, company, location…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={win} onChange={(e) => setWin(e.target.value)}>{WINDOWS.map(([v, l]) => <option key={v} value={v}>Posted: {l}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="blr">Sort: Bengaluru first, then remote</option><option value="score">Sort: best match</option><option value="new">Sort: newest</option><option value="cv">Sort: CV match</option>
          </select>
          <select value={exp} onChange={(e) => setExp(e.target.value)}>{EXP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
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

      <div className="row" style={{ marginBottom: 8, justifyContent: 'space-between' }}>
        <span className="muted small">{filtered.length} matching · Bengaluru office first, then remote open to India</span>
        <ExportButton title="Jobs" subtitle={`Filters: ${[q && `search “${q}”`, win !== '0' && `posted within ${win}h`, exp && `${exp} yrs experience`, roles.join('/'), regions.join('/')].filter(Boolean).join(' · ') || 'none'} · sorted ${sort}`}
          cols={[
            { header: 'Role', get: (j: Job) => j.title, width: 170, link: (j: Job) => j.url },
            { header: 'Company', get: (j: Job) => j.company, width: 100 },
            { header: 'Location', get: (j: Job) => j.location || 'not stated', width: 100 },
            { header: 'Where', get: (j: Job) => (j.locTags.includes('BLR') ? 'Bengaluru' : j.locTags.includes('REMOTE_IN') ? 'Remote (India OK)' : 'Not stated'), width: 70 },
            { header: 'Experience', get: (j: Job) => (j.exp ? `${j.exp.min}-${j.exp.max} yrs${j.exp.estimated ? ' (est.)' : ''}` : ''), width: 60 },
            { header: 'Pay', get: (j: Job) => j.salary || (j.payBand ? `est. ${j.payBand}` : ''), width: 85 },
            { header: 'Posted', get: (j: Job) => (j.postedAt || j.firstSeen).slice(0, 10), width: 55 },
            { header: 'Score', get: (j: Job) => j.score, width: 35 },
            { header: 'CV fit', get: (j: Job) => (j.cvMatch ? `${j.cvMatch}%` : ''), width: 40 },
            { header: 'Apply link', get: (j: Job) => j.url, link: (j: Job) => j.url },
          ]} rows={filtered} />
      </div>
      <div className="jobs">
        {filtered.slice(0, limit).map((j) => {
          const isNew = lastVisit && Date.parse(j.firstSeen) >= lastVisit;
          const where = j.locTags.includes('BLR') ? ['b-blr', 'Bengaluru office'] : j.locTags.includes('REMOTE_IN') ? ['b-ok', 'Remote · India OK'] : j.locTags.includes('UNSTATED') ? ['b-skip', 'Location not stated'] : ['b-skip', 'India · city not stated'];
          return (
            <div key={j.id} className="job">
              <div className="logo">{(j.company || '?').slice(0, 2).toUpperCase()}</div>
              <div className="job-main">
                <a className="job-title" href={j.url} target="_blank" rel="noreferrer noopener">{j.title}</a>
                {isNew ? <span className="badge b-new">NEW</span> : null}
                <div className="job-sub">
                  <b>{j.company || '—'}</b>
                  <span>· {j.location || 'location not stated'}</span>
                  <span title={j.postedAt || `first seen ${j.firstSeen}`}>· {j.postedAt ? 'posted' : 'seen'} {ago(j.postedAt || j.firstSeen)}</span>
                  <span className="hide-sm">· {j.sources.join(', ')}{j.via ? ` via ${j.via}` : ''}</span>
                </div>
                <div className="job-tags">
                  <span className={`badge ${where[0]}`}>{where[1]}</span>
                  {j.categories.map((c) => <span key={c} className={`badge b-${c}`}>{c === 'AIML' ? 'AI/ML' : 'FDE'}</span>)}
                  {j.domain && j.domain !== 'OTHER' && <span className="badge b-dom">{DOMAIN_LABEL[j.domain] || j.domain}</span>}
                  {j.hidden && <span className="badge b-SEMI">hidden gem</span>}
                  {j.exp && <span className="badge b-dom" title={j.exp.estimated ? 'estimated from seniority' : 'from the job post'}>{j.exp.min}–{j.exp.max} yrs{j.exp.estimated ? '*' : ''}</span>}
                  {j.salary ? <span className="badge b-money">{j.salary}</span> : j.payBand ? <span className="badge b-skip" title="Estimated from the Excel Salary_Intel sheet — not published by the employer">est. {j.payBand}</span> : null}
                  {(j.flags || []).map((f) => <span key={f} className={`badge ${f.startsWith('⚠') ? 'b-err' : 'b-warn'}`}>{f}</span>)}
                </div>
              </div>
              <div className="job-side">
                <div className="scores">
                  <div className="ring" style={{ ['--p' as string]: Math.min(100, j.score) }} title="Overall score"><span>{j.score}</span></div>
                  <div className="cvm" title="Skills matched with your CV">{j.cvMatch ? `${j.cvMatch}% CV` : 'CV –'}</div>
                </div>
                <div className="job-actions">
                  <a className="btn primary" href={j.url} target="_blank" rel="noreferrer noopener">Apply</a>
                  <button title="AI fit check vs your CV" onClick={() => setFit(j)}>✨ Fit</button>
                  {onOutreach && <button title="Find founders / managers to email" onClick={() => onOutreach(j.company, j.title)}>✉ People</button>}
                  <select value={track[j.id]?.status || ''} onChange={(e) => mark(j, (e.target.value || 'none') as TrackStatus | 'none')}>
                    <option value="">Track…</option>
                    {(Object.keys(STATUS_LABEL) as TrackStatus[]).map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
        {!filtered.length && jobs.length > 0 && <div className="empty">Nothing matches these filters. Try “Posted: 3 days” or clear filters.</div>}
      </div>
      {filtered.length > limit && <div style={{ textAlign: 'center', marginTop: 10 }}><button onClick={() => setLimit(limit + 200)}>Show more ({filtered.length - limit} left)</button></div>}
      {fit && <FitDrawer job={fit} onClose={() => setFit(null)} onApplied={() => { mark(fit, 'applied'); setFit(null); }} />}
    </>
  );
}
