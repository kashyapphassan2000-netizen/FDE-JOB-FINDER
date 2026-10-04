'use client';
import { useCallback, useEffect, useState } from 'react';
import JobsTab from '@/components/JobsTab';
import AgentTab from '@/components/AgentTab';
import DiscoverTab from '@/components/DiscoverTab';
import AiKeysTab from '@/components/AiKeysTab';
import TrackerTab from '@/components/TrackerTab';
import ExcelTab from '@/components/ExcelTab';
import PlatformsTab from '@/components/PlatformsTab';
import SourcesTab from '@/components/SourcesTab';
import CvTab from '@/components/CvTab';
import SettingsTab from '@/components/SettingsTab';
import { api, type JobsPayload } from '@/components/api';

const TABS = ['Jobs', 'AI Agent', 'Hidden jobs & startups', 'Tracker', 'Excel sheets', 'Platforms map', 'Sources & APIs', 'AI & Keys', 'CV', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const [tab, setTab] = useState<Tab>('Jobs');
  const [data, setData] = useState<JobsPayload | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

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
      if (t && TABS.includes(t)) setTab(t);
    } catch {}
    load();
    const iv = setInterval(load, 5 * 60 * 1000); // auto-reload data every 5 min
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function go(t: Tab) {
    setTab(t);
    try { localStorage.setItem('fj_tab', t); } catch {}
  }

  async function refreshNow(force = false) {
    setBusy(true);
    setToast('Refreshing all sources… (up to ~90s)');
    try {
      const r = await api<{ added: number; total: number; ran: string[]; failed: string[]; skipped: string[]; ms: number }>('/api/refresh', { method: 'POST', body: JSON.stringify({ force }) });
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

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">🔎 FDE Job Finder <small>FDE + AI/ML roles · every domain · Bengaluru · India · USA · Remote</small></div>
        <div className="row">
          <span className="muted small">
            {data?.meta?.lastRefresh ? `Last refresh ${new Date(data.meta.lastRefresh).toLocaleString()} (${data.meta.trigger})` : 'Never refreshed'}
          </span>
          <button className="primary" disabled={busy} onClick={() => refreshNow(false)}>{busy ? 'Refreshing…' : '⟳ Refresh now'}</button>
          <button disabled={busy} onClick={() => refreshNow(true)} title="Ignore quota cooldowns and call every configured API now">Force all</button>
          <button onClick={logout}>Log out</button>
        </div>
      </div>
      {data?.storeMode === 'memory' && (
        <div className="notice warn">
          Storage is in <b>memory mode</b> – your tracker and settings will be lost on redeploy. Connect <b>Upstash for Redis</b> in Vercel → Storage (see the PDF, step 4).
        </div>
      )}
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => go(t)}>
            {t}
            {t === 'Tracker' && data ? ` (${Object.keys(data.track).length})` : ''}
          </button>
        ))}
      </div>
      {tab === 'Jobs' && <JobsTab data={data} reload={load} toast={setToast} />}
      {tab === 'AI Agent' && <AgentTab toast={setToast} />}
      {tab === 'Hidden jobs & startups' && <DiscoverTab toast={setToast} />}
      {tab === 'AI & Keys' && <AiKeysTab toast={setToast} />}
      {tab === 'Tracker' && <TrackerTab data={data} reload={load} toast={setToast} />}
      {tab === 'Excel sheets' && <ExcelTab toast={setToast} />}
      {tab === 'Platforms map' && <PlatformsTab toast={setToast} />}
      {tab === 'Sources & APIs' && <SourcesTab toast={setToast} reload={load} />}
      {tab === 'CV' && <CvTab toast={setToast} />}
      {tab === 'Settings' && <SettingsTab toast={setToast} />}
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}
    </div>
  );
}
