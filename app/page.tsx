'use client';
import { useCallback, useEffect, useState } from 'react';
import JobsTab from '@/components/JobsTab';
import AgentTab from '@/components/AgentTab';
import DiscoverTab from '@/components/DiscoverTab';
import OutreachTab from '@/components/OutreachTab';
import AiKeysTab from '@/components/AiKeysTab';
import TrackerTab from '@/components/TrackerTab';
import ExcelTab from '@/components/ExcelTab';
import PlatformsTab from '@/components/PlatformsTab';
import SourcesTab from '@/components/SourcesTab';
import CvTab from '@/components/CvTab';
import SettingsTab from '@/components/SettingsTab';
import { ago, api, type JobsPayload } from '@/components/api';

const NAV = [
  { group: 'Find', items: [['Jobs', '💼'], ['AI Agent', '🤖'], ['Hidden jobs & startups', '💎'], ['Outreach', '✉️']] },
  { group: 'Track', items: [['Tracker', '📌'], ['CV', '📄']] },
  { group: 'Library', items: [['Excel sheets', '📊'], ['Platforms map', '🗺️']] },
  { group: 'Setup', items: [['Sources & APIs', '🔌'], ['AI & Keys', '🔑'], ['Settings', '⚙️']] },
] as const;
type Tab = (typeof NAV)[number]['items'][number][0];
const ALL: Tab[] = NAV.flatMap((g) => g.items.map((i) => i[0] as Tab));

export default function Home() {
  const [tab, setTab] = useState<Tab>('Jobs');
  const [data, setData] = useState<JobsPayload | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [seed, setSeed] = useState<{ company: string; role: string; n: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<JobsPayload>('/api/jobs'));
    } catch (e) {
      setToast((e as Error).message);
    }
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem('fj_tab') as Tab | null;
      if (t && ALL.includes(t)) setTab(t);
    } catch {}
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
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

  async function refreshNow(force = false) {
    setBusy(true);
    setToast('Refreshing all sources… (up to ~90s)');
    try {
      const r = await api<{ added: number; total: number; ran: string[]; failed: string[]; ms: number }>('/api/refresh', { method: 'POST', body: JSON.stringify({ force }) });
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
        {NAV.map((g) => (
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
          <h1>{tab}</h1>
          <div className="row top-actions">
            <span className="muted small hide-sm">{data?.meta?.lastRefresh ? `Updated ${ago(data.meta.lastRefresh)}` : 'Never refreshed'}</span>
            <button className="primary" disabled={busy} onClick={() => refreshNow(false)}>{busy ? 'Refreshing…' : '⟳ Refresh'}</button>
            <button className="hide-sm" disabled={busy} onClick={() => refreshNow(true)} title="Ignore quota cooldowns and call every configured API now">Force all</button>
          </div>
        </header>
        {data?.storeMode === 'memory' && (
          <div className="notice warn">Storage is in <b>memory mode</b> – data is lost on redeploy. Connect Upstash Redis (PDF step 4).</div>
        )}
        {tab === 'Jobs' && <JobsTab data={data} reload={load} toast={setToast} onOutreach={(company, role) => { setSeed({ company, role, n: Date.now() }); go('Outreach'); }} />}
        {tab === 'AI Agent' && <AgentTab toast={setToast} />}
        {tab === 'Hidden jobs & startups' && <DiscoverTab toast={setToast} />}
        {tab === 'Outreach' && <OutreachTab toast={setToast} seed={seed} />}
        {tab === 'AI & Keys' && <AiKeysTab toast={setToast} />}
        {tab === 'Tracker' && <TrackerTab data={data} reload={load} toast={setToast} />}
        {tab === 'Excel sheets' && <ExcelTab toast={setToast} />}
        {tab === 'Platforms map' && <PlatformsTab toast={setToast} />}
        {tab === 'Sources & APIs' && <SourcesTab toast={setToast} reload={load} />}
        {tab === 'CV' && <CvTab toast={setToast} />}
        {tab === 'Settings' && <SettingsTab toast={setToast} />}
      </main>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}
    </div>
  );
}
