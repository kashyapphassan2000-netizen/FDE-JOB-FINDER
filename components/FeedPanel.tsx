'use client';
import { useEffect, useState } from 'react';
import { ago, api, type JobsPayload } from './api';
import type { Job } from '@/lib/types';
import ExportButton from './ExportButton';
import { ReachButton, SaveButton } from './ReachButton';

/** Live jobs for an agent tab, straight from the job feed (every ATS board + LinkedIn, refreshed hourly) — no web search needed. */
const FILTERS: Record<string, { title: string; test: (j: Job) => boolean }> = {
  'remote-india': { title: 'Remote, open to India', test: (j) => j.locTags.includes('REMOTE_IN') },
  'global-remote': { title: 'Remote worldwide (US / EU companies hiring anywhere)', test: (j) => j.locTags.includes('REMOTE_IN') && /worldwide|anywhere|global|united states|usa|europe|emea|\bus\b|\beu\b|remote$/i.test(j.location) },
  domains: { title: 'Semiconductor & embedded AI', test: (j) => j.domain === 'SEMI' || j.domain === 'EMBEDDED' },
  'blr-hidden': { title: 'Bengaluru — startups & low-competition roles', test: (j) => j.locTags.includes('BLR') && (j.hidden || /startup|seed|series [ab]/i.test(`${j.company} ${j.description || ''}`) || j.domain === 'AI_INFRA' || j.domain === 'AI_LAB') },
  communities: { title: 'From Hacker News, Reddit & Telegram', test: (j) => j.sources.some((s) => ['hn', 'reddit', 'telegram'].includes(s)) },
  'new-startups': { title: 'Startups hiring (company boards)', test: (j) => j.sources.some((s) => ['yc_jobs', 'ashby', 'careerpages'].includes(s)) },
};
export function hasFeed(id: string) { return Boolean(FILTERS[id]); }

// communities move fast: only the last 3 days; other tabs: last 30 days
const MAX_AGE_H: Record<string, number> = { communities: 72 };

export default function FeedPanel({ missionId, toast = () => {} }: { missionId: string; toast?: (s: string) => void }) {
  const [d, setD] = useState<JobsPayload | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api<JobsPayload>('/api/jobs').then(setD).catch(() => null); }, []);
  const f = FILTERS[missionId];
  if (!f) return null;
  const when = (j: Job) => j.postedAt || j.firstSeen;
  const maxH = MAX_AGE_H[missionId] || 720;
  const matching = (d?.jobs || []).filter(f.test);
  const jobs = matching.filter((j) => Date.now() - Date.parse(when(j)) <= maxH * 36e5).sort((a, b) => when(b).localeCompare(when(a)));
  const older = matching.length - jobs.length;
  const shown = all ? jobs : jobs.slice(0, 25);
  return (
    <div className="panel live-feed">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}><span className="live-dot" /> LIVE from your job feed — {f.title} <span className="small muted">· {jobs.length} open{d?.meta?.lastRefresh ? ` · feed updated ${ago(d.meta.lastRefresh)} ago` : ''}</span></h3>
        {jobs.length > 0 && <ExportButton title={`${f.title} (live feed)`} sections={[{ title: 'Jobs', headers: ['Title', 'Company', 'Location', 'Posted', 'Link'], rows: jobs.map((j) => [j.title, j.company, j.location, when(j).slice(0, 10), j.url]) }]} />}
      </div>
      <p className="small muted" style={{ margin: '4px 0 8px' }}>Straight from every company job board + LinkedIn (refreshed every hour and whenever the app is opened). Newest first. The agent results below add posts and pages found by web search.</p>
      {!d && <div className="small muted">Loading…</div>}
      {d && !jobs.length && <div className="small muted">No open roles of this kind in the last {maxH / 24} days right now.</div>}
      {older > 0 && <div className="small muted">{older} older item{older > 1 ? 's' : ''} (over {maxH / 24} days) hidden to keep this fresh.</div>}
      {shown.map((j) => <div key={j.id} className="tline"><b><a href={j.url} target="_blank" rel="noreferrer">{j.title} ↗</a></b> — {j.company} <span className="small muted">· {j.location} · {j.postedAt ? `posted ${ago(j.postedAt)} ago` : `seen ${ago(j.firstSeen)} ago`} · {j.sources.join('/')}</span> <span className="row" style={{ gap: 6, display: 'inline-flex' }}><ReachButton item={{ title: j.title, company: j.company, url: j.url, location: j.location, text: j.description?.slice(0, 1500) }} toast={toast} /><SaveButton item={{ title: j.title, company: j.company, url: j.url, location: j.location, text: j.description?.slice(0, 1500) }} toast={toast} folder={missionId === 'communities' ? 'Saved posts' : 'Saved jobs'} /></span></div>)}
      {jobs.length > 25 && <button className="small-btn" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${jobs.length}`}</button>}
    </div>
  );
}
