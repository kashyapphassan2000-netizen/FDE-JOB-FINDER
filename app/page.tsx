'use client';
import { useCallback, useEffect, useState } from 'react';
import JobsTab from '@/components/JobsTab';
import AgentTab from '@/components/AgentTab';
import DiscoverTab from '@/components/DiscoverTab';
import OutreachTab from '@/components/OutreachTab';
import OpportunitiesTab from '@/components/OpportunitiesTab';
import TrendsTab from '@/components/TrendsTab';
import SearchTab from '@/components/SearchTab';
import IntelTab from '@/components/IntelTab';
import ExportAllButton from '@/components/ExportAllButton';
import DirectoryTab from '@/components/DirectoryTab';
import WatchTab from '@/components/WatchTab';
import MentorTab from '@/components/MentorTab';
import StudioTab from '@/components/StudioTab';
import RadarTab from '@/components/RadarTab';
import AutopilotPanel from '@/components/AutopilotPanel';
import ObservabilityTab from '@/components/ObservabilityTab';
import NotepadTab from '@/components/NotepadTab';
import ApplyTab from '@/components/ApplyTab';
import UnlimitedTab from '@/components/UnlimitedTab';
import KnowledgeGraph from '@/components/KnowledgeGraph';
import CareersSearchTab from '@/components/CareersSearchTab';
import AnalyzerTab from '@/components/AnalyzerTab';
import ReferralsTab from '@/components/ReferralsTab';
import Onboarding from '@/components/Onboarding';
import AlertsTab from '@/components/AlertsTab';
import DashboardTab from '@/components/DashboardTab';
import AiKeysTab from '@/components/AiKeysTab';
import TrackerTab from '@/components/TrackerTab';
import ExcelTab from '@/components/ExcelTab';
import PlatformsTab from '@/components/PlatformsTab';
import SourcesTab from '@/components/SourcesTab';
import CvTab from '@/components/CvTab';
import SettingsTab from '@/components/SettingsTab';
import { ago, api, type JobsPayload } from '@/components/api';

const NAV = [
  { group: 'Agents', items: [['Agent studio', '🤖']] },
  { group: 'Life', items: [['Life mentor', '🧭'], ['Knowledge graph', '🕸️']] },
  { group: 'Companies', items: [['Zero-day radar', '🛰️'], ['Careers search', '🎯'], ['Global companies hiring', '🌍'], ['Watch companies', '👁️']] },
  { group: 'Get the job', items: [['Auto-apply', '⚡'], ['Job analyzer & prep', '🔬'], ['Recruiters & referrals', '🤝'], ['My job alerts', '🔔'], ['Job alerts for others', '📬']] },
  { group: 'Find', items: [['My dashboard', '🏠'], ['Search any role', '🔍'], ['Jobs', '💼'], ['AI Agent', '🤖'], ['Trends', '📈'], ['Hiring radar', '📡'], ['Layoffs', '📉'], ['Hidden jobs & startups', '💎'], ['Outreach', '✉️'], ['Opportunities', '🏆']] },
  { group: 'Agent searches', items: [['Hidden Bengaluru', '📍'], ['Remote India', '🏠'], ['US / EU remote', '🌍'], ['Semi & Embedded AI', '🔧'], ['New startups', '🚀'], ['Communities', '👥']] },
  { group: 'Track', items: [['Tracker', '📌'], ['CV', '📄'], ['Notepad', '📝']] },
  { group: 'Library', items: [['Excel sheets', '📊'], ['Excel coverage map', '🗺️']] },
  { group: 'Setup', items: [['Unlimited setup', '🔓'], ['Observability', '🩺'], ['Sources & APIs', '🔌'], ['AI & Keys', '🔑'], ['Settings', '⚙️']] },
] as const;
type Tab = (typeof NAV)[number]['items'][number][0];
const ALL: Tab[] = NAV.flatMap((g) => g.items.map((i) => i[0] as Tab));
const MEMBER_HIDDEN = ['Sources & APIs', 'AI & Keys', 'Settings', 'Job alerts for others', 'Unlimited setup'] as const;
const MISSION_TABS: Record<string, string> = {
  'Hidden Bengaluru': 'blr-hidden', 'Remote India': 'remote-india',
  'US / EU remote': 'global-remote', 'Semi & Embedded AI': 'domains', 'New startups': 'new-startups', Communities: 'communities',
};

export default function Home() {
  const [tab, setTab] = useState<Tab>('My dashboard');
  const [data, setData] = useState<JobsPayload | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [seed, setSeed] = useState<{ company: string; role: string; n: number } | null>(null);
  const [mentorSeed, setMentorSeed] = useState<{ q: string; n: number } | null>(null);
  const [anaSeed, setAnaSeed] = useState<{ url: string; company: string; n: number } | null>(null);
  const [refSeed, setRefSeed] = useState<{ company: string; role: string; n: number } | null>(null);
  const [sq, setSq] = useState('');
  const [sqInput, setSqInput] = useState('');
  const [applySeed, setApplySeed] = useState<{ url: string; title: string; company: string; n: number } | null>(null);
  const [me, setMe] = useState<{ email: string; role: 'owner' | 'member'; until: string | null; profileSet: boolean; used: number; limit: number | null; search?: { configured: number; live: number; parked: string[] } } | null>(null);
  const isOwner = me?.role === 'owner';
  // users (non-owners) never see settings, keys, access or the "alerts for other people" page
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter(([t]) => isOwner || !(MEMBER_HIDDEN as readonly string[]).includes(t)) })).filter((g) => g.items.length);

  const load = useCallback(async () => {
    try {
      const p = await api<JobsPayload & { refreshing?: boolean }>('/api/jobs');
      setData(p);
      if (p.refreshing) setTimeout(() => api<JobsPayload>('/api/jobs').then(setData).catch(() => null), 70000); // show the live refresh when it lands
    } catch (e) {
      setToast((e as Error).message);
    }
  }, []);

  useEffect(() => {
    try {
      const t = (new URLSearchParams(window.location.search).get('tab') || localStorage.getItem('fj_tab')) as Tab | null; // ?tab= from app shortcuts
      if (t && ALL.includes(t)) setTab(t);
    } catch {}
    load();
    api<NonNullable<typeof me>>('/api/auth/me').then(setMe).catch(() => null);
    const iv = setInterval(() => { load(); api<NonNullable<typeof me>>('/api/auth/me').then(setMe).catch(() => null); }, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function go(t: Tab) {
    setTab(t);
    setMenu(false);
    window.scrollTo({ top: 0 });
    try { localStorage.setItem('fj_tab', t); } catch {}
  }

  async function refreshNow(force = false, reset = false) {
    if (reset && !window.confirm('Delete the current job list and fetch everything fresh? Your Tracker (saved/applied) is kept.')) return;
    setBusy(true);
    setToast('Refreshing all sources… (up to ~90s)');
    try {
      const r = await api<{ added: number; total: number; ran: string[]; failed: string[]; ms: number }>('/api/refresh', { method: 'POST', body: JSON.stringify({ force, reset }) });
      setToast(`Done in ${(r.ms / 1000).toFixed(1)}s · ${r.added} new · ${r.total} total · ${r.ran.length} sources ran${r.failed.length ? ` · ${r.failed.length} failed (see Sources & APIs)` : ''}`);
      await load();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const tracked = data ? Object.keys(data.track).length : 0;
  const new24 = data ? data.jobs.filter((j) => Date.now() - Date.parse(j.firstSeen) < 864e5).length : 0;

  return (
    <div className="shell">
      <aside className={`side ${menu ? 'show' : ''}`}>
        <div className="brand">
          <div className="brand-mark">F</div>
          <div><b>FDE Job Finder</b><small>Bengaluru office · remote</small></div>
        </div>
        {nav.map((g) => (
          <div key={g.group} className="nav-group">
            <div className="nav-label">{g.group}</div>
            {g.items.map(([t, icon]) => (
              <button key={t} className={`nav ${tab === t ? 'on' : ''}`} onClick={() => go(t as Tab)}>
                <span className="nav-ic">{icon}</span>{t}
                {t === 'Jobs' && new24 > 0 && <span className="nav-n">{new24}</span>}
                {t === 'Tracker' && tracked > 0 && <span className="nav-n soft">{tracked}</span>}
              </button>
            ))}
          </div>
        ))}
        <button className="nav logout" onClick={logout}><span className="nav-ic">↩</span>Log out</button>
      </aside>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="burger" onClick={() => setMenu(true)} aria-label="Menu">☰</button>
          <h1 className="hide-sm">{tab}</h1>
          <form className="topsearch" onSubmit={(e) => { e.preventDefault(); if (sqInput.trim()) { setSq(sqInput.trim()); go('Search any role'); } }}>
            <input placeholder="🔍 Any role, anywhere — e.g. “ML engineer jobs in Berlin, remote ok”" value={sqInput} onChange={(e) => setSqInput(e.target.value)} />
          </form>
          <div className="row top-actions">
            <span className="muted small hide-sm">{data?.meta?.lastRefresh ? `Updated ${ago(data.meta.lastRefresh)} ago` : 'Never refreshed'}{(data as { refreshing?: boolean } | null)?.refreshing ? ' · refreshing live…' : ''}</span>
            {me && !isOwner && <span className="badge b-dom small" title={`Signed in as ${me.email}`}>⚡ {me.used}/{me.limit} AI today{me.until ? ` · ⏱ ${Math.max(0, Math.round((Date.parse(me.until) - Date.now()) / 6e4))} min left` : ''}</span>}
            {isOwner && <button className="primary" disabled={busy} onClick={() => refreshNow(false)}>{busy ? 'Refreshing…' : '⟳ Refresh'}</button>}
            {isOwner && <button className="hide-sm" disabled={busy} onClick={() => refreshNow(true)} title="Ignore quota cooldowns and call every configured API now">Force all</button>}
            <ExportAllButton toast={setToast} />
            {tab === 'Jobs' && isOwner && <button className="hide-sm danger" disabled={busy} onClick={() => refreshNow(true, true)} title="Delete stored jobs and refetch everything">🗑 Clear & refetch</button>}
          </div>
        </header>
        {me?.search && me.search.live === 0 && (
          <div className="notice err"><b>🔍 Web search is OFF — {me.search.configured ? `free quota used up (${me.search.parked.join(', ')})` : 'no search key'}.</b> Everything that searches the web is paused: X / LinkedIn <i>posts</i>, agent tabs, deep research, job analyzer research, referrals, “Search any role”. Still LIVE without search: Jobs (all ATS + LinkedIn jobs), LinkedIn live panel, careers search, radar, trends, layoffs. {isOwner ? <>Fix: open <button className="small-btn primary" onClick={() => go('Unlimited setup')}>🔓 Unlimited setup</button> — your own SearXNG (unlimited), Linkup (~4,000/month free), Exa, Firecrawl, Serper… each with steps and a Save &amp; test box. Tavily resets on the 1st.</> : 'Ask the owner to add a free search key.'}</div>
        )}
        {me && !isOwner && !me.profileSet && tab !== 'Careers search' && (
          <Onboarding toast={setToast} onMentor={(q) => { setMentorSeed({ q, n: Date.now() }); go('Life mentor'); }} onSearch={(q) => { setSqInput(q); setSq(q); go('Search any role'); }} />
        )}
        {data?.storeMode === 'memory' && (
          <div className="notice warn">Storage is in <b>memory mode</b> – data is lost on redeploy. Connect Upstash Redis (PDF step 4).</div>
        )}
        {tab === 'Jobs' && <JobsTab onApply={(url, title, company) => { setApplySeed({ url, title, company, n: Date.now() }); go('Auto-apply'); }} data={data} reload={load} toast={setToast} onOutreach={(company, role) => { setSeed({ company, role, n: Date.now() }); go('Outreach'); }} />}
        {tab === 'AI Agent' && <AgentTab toast={setToast} onOutreach={(company, role) => { setSeed({ company, role, n: Date.now() }); go('Outreach'); }} />}
        {tab === 'Hidden jobs & startups' && <DiscoverTab toast={setToast} />}
        {tab === 'Agent studio' && <StudioTab toast={setToast} />}
        {tab === 'Life mentor' && <MentorTab toast={setToast} seed={mentorSeed} openGraph={() => go('Knowledge graph')} />}
        {tab === 'Knowledge graph' && <KnowledgeGraph toast={setToast} onAsk={(q) => { setMentorSeed({ q, n: Date.now() }); go('Life mentor'); }} />}
        {isOwner && tab === 'Unlimited setup' && <UnlimitedTab toast={setToast} onAiKeys={() => go('AI & Keys')} />}
        {tab === 'Auto-apply' && <ApplyTab toast={setToast} seedUrl={applySeed} />}
        {tab === 'Observability' && <ObservabilityTab toast={setToast} onOpenAgent={() => go('Agent studio')} />}
        {tab === 'Notepad' && <NotepadTab toast={setToast} onUse={(text, where) => { if (where === 'mentor') { setMentorSeed({ q: text, n: Date.now() }); go('Life mentor'); } else if (where === 'analyze') { setAnaSeed({ url: /^https?:\/\//.test(text.trim()) ? text.trim() : '', company: '', n: Date.now() }); go('Job analyzer & prep'); } else { navigator.clipboard.writeText(text).then(() => setToast('Copied — paste it into any agent chat')); go('Agent studio'); } }} />}
        {tab === 'Zero-day radar' && <RadarTab toast={setToast} isOwner={isOwner} onWatch={(c) => api('/api/watch', { method: 'POST', body: JSON.stringify({ input: c }) }).then(() => setToast(`Watching ${c} — see Watch companies`)).catch((e) => setToast((e as Error).message))} />}
        {tab === 'Careers search' && <CareersSearchTab toast={setToast} onAnalyze={(url, company) => { setAnaSeed({ url, company, n: Date.now() }); go('Job analyzer & prep'); }} />}
        {tab === 'Watch companies' && <WatchTab toast={setToast} />}
        {tab === 'Job analyzer & prep' && <AnalyzerTab toast={setToast} seed={anaSeed} onReferrals={(company, role) => { setRefSeed({ company, role, n: Date.now() }); go('Recruiters & referrals'); }} />}
        {tab === 'Recruiters & referrals' && <ReferralsTab toast={setToast} seed={refSeed} />}
        {isOwner && tab === 'Job alerts for others' && <AlertsTab toast={setToast} />}
        {tab === 'My job alerts' && <AlertsTab toast={setToast} mine />}
        {tab === 'Global companies hiring' && <DirectoryTab toast={setToast} onOutreach={(company, role) => { setSeed({ company, role, n: Date.now() }); go('Outreach'); }} />}
        {tab === 'Outreach' && <OutreachTab toast={setToast} seed={seed} />}
        {tab === 'Opportunities' && <OpportunitiesTab toast={setToast} />}
        {isOwner && tab === 'AI & Keys' && <AiKeysTab toast={setToast} />}
        {tab === 'Tracker' && <TrackerTab data={data} reload={load} toast={setToast} />}
        {tab === 'Excel sheets' && <ExcelTab toast={setToast} />}
        {tab === 'Excel coverage map' && <PlatformsTab toast={setToast} />}
        {tab === 'My dashboard' && <DashboardTab toast={setToast} />}
        {tab === 'Trends' && <TrendsTab toast={setToast} />}
        {(tab === 'Hiring radar' || tab === 'Layoffs') && <IntelTab key={tab} mode={tab === 'Layoffs' ? 'layoffs' : 'hiring'} toast={setToast} onOutreach={(company, role) => { setSeed({ company, role, n: Date.now() }); go('Outreach'); }} />}
        {tab === 'Search any role' && <SearchTab q={sq} toast={setToast} onOutreach={(company, role) => { setSeed({ company, role, n: Date.now() }); go('Outreach'); }} />}
        {MISSION_TABS[tab] && <AgentTab key={tab} missionId={MISSION_TABS[tab]} toast={setToast} onOutreach={(company, role) => { setSeed({ company, role, n: Date.now() }); go('Outreach'); }} />}
        {isOwner && tab === 'Sources & APIs' && <SourcesTab toast={setToast} reload={load} />}
        {tab === 'CV' && <><CvTab toast={setToast} /><AutopilotPanel toast={setToast} /></>}
        {isOwner && tab === 'Settings' && <SettingsTab toast={setToast} />}
      </main>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}
    </div>
  );
}
