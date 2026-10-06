'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Category, Domain, Job, TrackStatus } from '@/lib/types';
import { ago, api, setTrack, STATUS_LABEL, type JobsPayload } from './api';
import { scoreJob, type Profile } from '@/lib/relevance';
import FitDrawer from './FitDrawer';
import { ReachButton } from './ReachButton';
import { SOURCE_ICON, SOURCE_TYPES, sourceType, srcKeys } from '@/lib/sourcetype';
import SourceFilter, { useSourceFilter } from './SourceFilter';
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

const hue = (s: string) => [...(s || 'x')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const matchLabel = (n: number) => (n >= 80 ? 'STRONG MATCH' : n >= 60 ? 'GOOD MATCH' : n >= 40 ? 'FAIR MATCH' : 'LOW MATCH');

export default function JobsTab({ data, reload, toast, onOutreach, onApply }: { data: JobsPayload | null; reload: () => void; toast: (s: string) => void; onOutreach?: (company: string, role: string) => void; onApply?: (url: string, title: string, company: string) => void }) {
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState<Category[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [win, setWin] = useState('24');
  const [quick, setQuick] = useState<'all' | 'blr' | 'remote' | 'fde' | 'saved'>('all');
  const [src, setSrc] = useState('');
  const [stype, setStype] = useState('');
  const [sen, setSen] = useState('');
  const [sort, setSort] = useState<'prio' | 'blr' | 'score' | 'new' | 'cv' | 'ai'>('prio');
  const [ranking, setRanking] = useState(false);
  // raw cosine values sit in a narrow band (≈0.80–0.92) → show where a job stands relative to the rest
  const semSorted = useMemo(() => Object.values(data?.sem || {}).map((x) => x.s).sort((a, b) => a - b), [data?.sem]);
  const semPct = (v: number) => (semSorted.length ? (semSorted.filter((x) => x <= v).length / semSorted.length) * 100 : 0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [onlyPrio, setOnlyPrio] = useState(false);
  useEffect(() => { api<{ profile: Profile }>('/api/profile').then((d) => setProfile(d.profile)).catch(() => {}); }, []);
  const [exp, setExp] = useState('');
  const [hideTracked, setHideTracked] = useState(true);
  const [onlyNew, setOnlyNew] = useState(false);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [salaryOnly, setSalaryOnly] = useState(false);
  const [limit, setLimit] = useState(100);
  const [lastVisit, setLastVisit] = useState<number>(0);
  const [fit, setFit] = useState<Job | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => { if (window.innerWidth < 900) setShowFilters(false); }, []);

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem('fj_filters5') || '{}');
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
    try { localStorage.setItem('fj_filters5', JSON.stringify({ roles, domains, regions, win, sort, sen })); } catch {}
  }, [roles, domains, regions, win, sort, sen]);

  const jobs = data?.jobs || [];
  const track = data?.track || {};
  const sources = useMemo(() => Array.from(new Set(jobs.flatMap((j) => j.sources))).sort(), [jobs]);

  const filtered0 = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const maxH = Number(win);
    let out = jobs.filter((j) => {
      if (quick === 'saved') { if (!track[j.id] || track[j.id].status === 'ignored') return false; } else if (hideTracked && track[j.id]) return false;
      if (quick === 'blr' && !j.locTags.includes('BLR')) return false;
      if (quick === 'remote' && !j.locTags.includes('REMOTE_IN')) return false;
      if (quick === 'fde' && !j.categories.includes('FDE')) return false;
      if (roles.length && !roles.some((c) => j.categories.includes(c))) return false;
      if (domains.length && !domains.includes(j.domain)) return false;
      if (regions.length && !regions.some((l) => j.locTags.includes(l))) return false;
      if (src && !j.sources.includes(src)) return false;
      if (stype && sourceType(j.url, j.sources) !== stype) return false;
      if (sen && j.seniority !== sen) return false;
      if (hiddenOnly && !j.hidden) return false;
      if (salaryOnly && !j.salary) return false;
      if (maxH && Date.now() - Date.parse(j.postedAt || j.firstSeen) > maxH * 36e5) return false;
      if (onlyNew && lastVisit && Date.parse(j.firstSeen) < lastVisit) return false;
      if (exp && j.exp) { const [a, b] = exp.split('-').map(Number); if (j.exp.max < a || j.exp.min > b) return false; }
      if (needle && !`${j.title} ${j.company} ${j.location} ${j.via || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (profile && (sort === 'prio' || onlyPrio)) {
      const sc = new Map(out.map((j) => [j.id, scoreJob({ title: j.title, company: j.company, location: j.location, description: j.description, postedAt: j.postedAt }, profile)]));
      if (onlyPrio) out = out.filter((j) => sc.get(j.id)!.keep);
      if (sort === 'prio') out = [...out].sort((a, b) => { const x = sc.get(a.id)!, y = sc.get(b.id)!; return Number(y.keep) - Number(x.keep) || (x.roleRank < 0 ? 99 : x.roleRank) - (y.roleRank < 0 ? 99 : y.roleRank) || (x.locRank < 0 ? 99 : x.locRank) - (y.locRank < 0 ? 99 : y.locRank) || Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen); });
    }
    if (sort === 'blr') out = [...out].sort((a, b) => rank(a.locTags) - rank(b.locTags) || Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
    if (sort === 'new') out = [...out].sort((a, b) => Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
    if (sort === 'cv') out = [...out].sort((a, b) => b.cvMatch - a.cvMatch || b.score - a.score);
    if (sort === 'ai') { const S = data?.sem || {}; const v = (id: string) => (S[id]?.r ?? -1) * 10 + (S[id]?.s ?? 0); out = [...out].sort((a, b) => v(b.id) - v(a.id)); }
    return out;
  }, [jobs, track, q, roles, domains, regions, win, src, stype, sen, sort, hideTracked, onlyNew, lastVisit, hiddenOnly, salaryOnly, exp, quick, profile, onlyPrio]);
  const sf = useSourceFilter(filtered0, (j) => srcKeys(j.url, j.sources));
  const filtered = sf.visible;

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
  const clear = () => { setRoles([]); setDomains([]); setRegions([]); setSrc(''); setStype(''); setSen(''); setHiddenOnly(false); setSalaryOnly(false); setQ(''); setWin('24'); };

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
      <div className="jr-head">
        <div className="jr-tabs">
          {([['all', 'Recommended', jobs.length], ['blr', 'Bengaluru', counts.BLR || 0], ['remote', 'Remote · India', counts.REMOTE_IN || 0], ['fde', 'FDE', counts.FDE || 0], ['saved', 'Saved', Object.values(track).filter((t) => t.status !== 'ignored').length]] as const).map(([k, l, n]) => (
            <button key={k} className={quick === k ? 'on' : ''} onClick={() => setQuick(k)}>{l} <span>{n}</span></button>
          ))}
        </div>
        <div className="jr-kpis">
          <span><b>{counts.new24}</b> new today</span><span><b>{counts.hidden}</b> hidden gems</span>
        </div>
      </div>

      {!jobs.length && <div className="notice warn">No jobs yet. Click <b>⟳ Refresh now</b> (top right). First run takes 30–90 seconds.</div>}

      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="grow" placeholder="Search title, company, location…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={win} onChange={(e) => setWin(e.target.value)}>{WINDOWS.map(([v, l]) => <option key={v} value={v}>Posted: {l}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="prio">Sort: my priorities (roles → locations → newest)</option><option value="blr">Sort: Bengaluru first, then remote</option><option value="score">Sort: best match</option><option value="new">Sort: newest</option><option value="cv">Sort: CV match</option><option value="ai">Sort: 🧠 best AI match (semantic + rerank)</option>
          </select>
          <select value={exp} onChange={(e) => setExp(e.target.value)}>{EXP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label className="small"><input type="checkbox" checked={onlyPrio} onChange={(e) => setOnlyPrio(e.target.checked)} /> only my priority roles & locations</label>
          <button onClick={() => setShowFilters(!showFilters)}>{showFilters ? 'Hide filters' : 'Filters'}</button>
          <button disabled={ranking} title={data?.semMeta ? `Last ranked ${ago(data.semMeta.at)} ago · ${data.semMeta.engine} + ${data.semMeta.reranker}` : 'Embeds every job and your profile, then reranks your top 50 against your tech stack'} onClick={async () => { setRanking(true); try { const r = await api<{ embedded: number; reranked: number; engine: string; reranker: string; ms: number }>('/api/jobs', { method: 'POST', body: JSON.stringify({ action: 'semantic' }) }); toast(`🧠 Ranked: ${r.embedded} jobs embedded, top ${r.reranked} reranked (${r.engine} · ${r.reranker}) in ${Math.round(r.ms / 1000)}s`); setSort('ai'); reload(); } catch (e) { toast((e as Error).message); } finally { setRanking(false); } }}>{ranking ? '🧠 Ranking…' : '🧠 Rank with AI'}</button>
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
              <select value={stype} onChange={(e) => setStype(e.target.value)} title="Where the job came from">
                <option value="">Every kind of source</option>{SOURCE_TYPES.map((t) => <option key={t} value={t}>{SOURCE_ICON[t]} {t} · {jobs.filter((j) => sourceType(j.url, j.sources) === t).length}</option>)}
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

      <SourceFilter counts={sf.counts} hidden={sf.hidden} setHidden={sf.setHidden} />
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
            <div key={j.id} className="jr-card">
              <div className="jr-body">
                <div className="jr-top">
                  <span className="jr-when">{j.postedAt ? `${ago(j.postedAt)} ago` : `seen ${ago(j.firstSeen)} ago`}</span>
                  {isNew ? <span className="jr-pill new">NEW</span> : null}
                  {j.postedAt && Date.now() - Date.parse(j.postedAt) < 864e5 && <span className="jr-pill early">⚡ Be an early applicant</span>}
                  {j.hidden && <span className="jr-pill gem">💎 Low competition</span>}
                  {(j.flags || []).map((f) => <span key={f} className={`jr-pill ${f.startsWith('⚠') ? 'bad' : 'warn'}`}>{f}</span>)}
                  {data?.sem?.[j.id] && <span className={`jr-pill ${(data.sem[j.id].r ?? 0) >= 0.85 ? 'gem' : 'early'}`} title={data.sem[j.id].why || 'semantic similarity to your profile'}>🧠 {data.sem[j.id].r !== undefined ? `fit ${Math.round(data.sem[j.id].r! * 100)}%` : `top ${Math.max(1, Math.round(100 - semPct(data.sem[j.id].s)))}%`}</span>}
                  {data?.drafts?.[j.id] && <span className="jr-pill gem" title={data.drafts[j.id].text}>✉ outreach draft ready</span>}
                </div>
                <div className="jr-id">
                  <div className="jr-logo" style={{ ['--h' as string]: hue(j.company) }}>{(j.company || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}</div>
                  <div className="jr-names">
                    <a className="jr-title" href={j.url} target="_blank" rel="noreferrer noopener">{j.title}</a>
                    <div className="jr-co">{j.company || '—'}{j.domain && j.domain !== 'OTHER' ? <span> · {DOMAIN_LABEL[j.domain] || j.domain}</span> : null}</div>
                  </div>
                </div>
                <div className="jr-facts">
                  <span>📍 {j.location || 'Not stated'}</span>
                  <span className={where[0] === 'b-blr' ? 'hl' : where[0] === 'b-ok' ? 'hl2' : ''}>🏢 {where[1]}</span>
                  {j.exp && <span title={j.exp.estimated ? 'estimated from seniority' : 'from the job post'}>🎓 {j.exp.min}–{j.exp.max} yrs{j.exp.estimated ? '*' : ''}</span>}
                  <span>⏱ Full-time</span>
                  {j.salary ? <span className="money">💰 {j.salary}</span> : j.payBand ? <span title="Estimate (Excel Salary_Intel)">💰 est. {j.payBand}</span> : null}
                  {j.categories.map((c) => <span key={c} className="role">{c === 'AIML' ? 'AI / ML' : 'FDE'}</span>)}
                </div>
                <div className="jr-actions">
                  <a className="jr-apply" href={j.url} target="_blank" rel="noreferrer noopener">Apply now</a>
                  <button className="jr-ghost" onClick={() => setFit(j)}>✨ Ask AI: am I a fit?</button>
                  <ReachButton item={{ title: j.title, company: j.company, url: j.url, location: j.location, text: j.description?.slice(0, 1500) }} toast={toast} />
                  {onOutreach && <button className="jr-ghost" onClick={() => onOutreach(j.company, j.title)}>✉ Find people</button>}
                  {onApply && !/linkedin\.com/.test(j.url) && <button className="jr-ghost" title="Read this job's application questions and answer them from your CV" onClick={() => onApply(j.url, j.title, j.company)}>⚡ Apply</button>}
                  <button className={`jr-icon ${track[j.id]?.status === 'saved' ? 'on' : ''}`} title="Save" onClick={() => mark(j, track[j.id]?.status === 'saved' ? 'none' : 'saved')}>{track[j.id]?.status === 'saved' ? '♥' : '♡'}</button>
                  <select className="jr-track" value={track[j.id]?.status || ''} onChange={(e) => mark(j, (e.target.value || 'none') as TrackStatus | 'none')}>
                    <option value="">Track…</option>
                    {(Object.keys(STATUS_LABEL) as TrackStatus[]).map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
                  </select>
                  <span className="jr-src hide-sm">{SOURCE_ICON[sourceType(j.url, j.sources)]} {sourceType(j.url, j.sources)} · via {j.sources[0]}{j.sources.length > 1 ? ` +${j.sources.length - 1}` : ''}</span>
                </div>
              </div>
              <div className="jr-match">
                <div className="jr-ring" style={{ ['--p' as string]: Math.min(100, Math.max(j.score, j.cvMatch)) }}><span>{Math.min(100, Math.max(j.score, j.cvMatch))}<small>%</small></span></div>
                <b>{matchLabel(Math.max(j.score, j.cvMatch))}</b>
                <small>{j.cvMatch ? `${j.cvMatch}% skills match your CV` : 'upload CV for skill match'}</small>
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
