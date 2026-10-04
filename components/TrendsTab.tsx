'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';

type Count = { key: string; n: number; change?: number; domain?: string };
type Trends = {
  total: number; jobs: number; posts: number; history: number; regions: Count[]; domains: Count[]; roles: Count[]; rolesThisWeek: Count[]; companies: Count[];
  skills: Count[]; rising: Count[]; newRoles: Count[]; skillsByDomain: { domain: string; skills: Count[] }[]; skillsByRegion: { region: string; skills: Count[] }[];
  yourSkills: { have: string[]; missing: string[]; cvUploaded: boolean };
};
type Report = {
  at: string; model?: string; headlines: { title: string; summary: string; region: string; url: string }[]; hot_skills: { skill: string; why: string; region: string }[];
  new_roles: { role: string; what: string; who_hires: string }[]; domains: { domain: string; ai_use_cases: string; companies: string; your_angle: string }[]; your_moves: string[]; sources: { title: string; url: string }[];
};

function Bars({ items, max, mine }: { items: Count[]; max?: number; mine?: Set<string> }) {
  const m = max || Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="bars">
      {items.map((i) => (
        <div key={i.key} className="barrow">
          <span className={`barlabel ${mine?.has(i.key) ? 'have' : ''}`} title={i.domain || ''}>{i.key}{mine?.has(i.key) ? ' ✓' : ''}</span>
          <span className="bar"><i style={{ width: `${Math.max(3, (i.n / m) * 100)}%` }} /></span>
          <span className="barn">{i.n}{i.change ? <b className="up"> +{i.change}%</b> : null}</span>
        </div>
      ))}
    </div>
  );
}

export default function TrendsTab({ toast }: { toast: (s: string) => void }) {
  const [t, setT] = useState<Trends | null>(null);
  const [r, setR] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ trends: Trends; report: Report | null }>('/api/trends').then((d) => { setT(d.trends); setR(d.report); }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  async function rebuild() {
    setBusy(true);
    toast('Reading fresh AI-jobs news for India, USA and global (≈8 searches, 30–90 s)…');
    try {
      const d = await api<{ report: Report }>('/api/trends', { method: 'POST' });
      setR(d.report);
      toast('Market report updated');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!t) return <div className="panel muted">Crunching trends…</div>;
  const mine = new Set(t.yourSkills.have);
  return (
    <>
      <div className="hero">
        <div>
          <h2>Where AI hiring is going</h2>
          <p>Computed live from {t.total.toLocaleString()} jobs and hiring posts the app collected ({t.jobs} jobs · {t.posts} agent finds), plus an AI market report from fresh news. Map your skills to the domains that are hiring and pitch AI solutions there.</p>
        </div>
        <div className="hero-stats">
          <div><b>{t.skills[0]?.key || '–'}</b><span>most asked skill</span></div>
          <div><b>{t.roles[0]?.key.split(' /')[0] || '–'}</b><span>most common role</span></div>
        </div>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>📰 Market report — India · USA · world</h3>
          <span className="row">{r && <span className="small muted">updated {ago(r.at)}{r.model ? ` · ${r.model}` : ''}</span>}<button className="primary small-btn" disabled={busy} onClick={rebuild}>{busy ? 'Reading news…' : r ? 'Refresh report' : 'Build report'}</button></span>
        </div>
        {!r && <p className="muted small">Click “Build report” — the agent searches the latest AI-hiring news and summarises headlines, hot skills, new roles and where AI is being deployed, mapped to your CV.</p>}
        {r && (
          <>
            <div className="grid2" style={{ marginTop: 12 }}>
              {r.headlines.map((h) => (
                <a key={h.url + h.title} className="card news" href={h.url} target="_blank" rel="noreferrer">
                  <span className="badge b-dom">{h.region}</span>
                  <h4>{h.title}</h4>
                  <div className="small muted">{h.summary}</div>
                </a>
              ))}
            </div>
            <div className="grid2" style={{ marginTop: 14 }}>
              <div>
                <h4>🔥 Hot skills right now</h4>
                {r.hot_skills.map((s) => <div key={s.skill} className="tline"><b>{s.skill}</b> <span className="badge b-skip">{s.region}</span><div className="small muted">{s.why}</div></div>)}
              </div>
              <div>
                <h4>🆕 New & emerging roles</h4>
                {r.new_roles.map((s) => <div key={s.role} className="tline"><b>{s.role}</b><div className="small">{s.what}</div><div className="small muted">Who hires: {s.who_hires}</div></div>)}
              </div>
            </div>
            <h4 style={{ marginTop: 14 }}>🏭 Domains deploying AI — and your angle</h4>
            <div className="grid2">
              {r.domains.map((d) => (
                <div key={d.domain} className="card">
                  <h4>{d.domain}</h4>
                  <div className="small"><b>AI use cases:</b> {d.ai_use_cases}</div>
                  <div className="small muted">Companies: {d.companies}</div>
                  <div className="small" style={{ marginTop: 4, color: 'var(--accent)' }}><b>Your angle:</b> {d.your_angle}</div>
                </div>
              ))}
            </div>
            {r.your_moves.length > 0 && (
              <div className="notice ok" style={{ marginTop: 12 }}><b>Your next moves:</b><ol style={{ margin: '6px 0 0' }}>{r.your_moves.map((m) => <li key={m}>{m}</li>)}</ol></div>
            )}
            <details className="small"><summary>{r.sources.length} sources</summary><ol>{r.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ol></details>
          </>
        )}
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>🧠 Skills employers ask for</h3>
          {!t.yourSkills.cvUploaded && <div className="small muted" style={{ marginBottom: 6 }}>Upload your CV to see which of these you already have (✓).</div>}
          <Bars items={t.skills} mine={mine} />
        </div>
        <div className="panel">
          <h3>📈 Rising skills (vs a week ago)</h3>
          {t.rising.length ? <Bars items={t.rising} mine={mine} /> : <p className="small muted">Building history — a daily snapshot is saved on every refresh ({t.history} so far). Rising skills appear after 7 days.</p>}
          <h3 style={{ marginTop: 16 }}>🆕 Role types new this week</h3>
          {t.newRoles.length ? <Bars items={t.newRoles} /> : t.rolesThisWeek.length ? <Bars items={t.rolesThisWeek} /> : <p className="small muted">Appears after a few days of history.</p>}
          {t.yourSkills.cvUploaded && (
            <>
              <h3 style={{ marginTop: 16 }}>🎯 Your gap — top-demand skills missing from your CV</h3>
              <div className="row">{t.yourSkills.missing.map((s) => <span key={s} className="badge b-err">{s}</span>)}</div>
            </>
          )}
        </div>
        <div className="panel">
          <h3>💼 Roles being hired</h3>
          <Bars items={t.roles} />
        </div>
        <div className="panel">
          <h3>📍 Where</h3>
          <Bars items={t.regions} />
          <h3 style={{ marginTop: 16 }}>🏭 Domains</h3>
          <Bars items={t.domains} />
        </div>
        <div className="panel">
          <h3>🏢 Who is hiring most</h3>
          <Bars items={t.companies} />
        </div>
        <div className="panel">
          <h3>🧩 Skills by domain</h3>
          {t.skillsByDomain.map((d) => (
            <div key={d.domain} style={{ marginBottom: 10 }}>
              <div className="small"><b>{d.domain}</b></div>
              <div className="row">{d.skills.map((s) => <span key={s.key} className={`badge ${mine.has(s.key) ? 'b-ok' : 'b-dom'}`}>{s.key} · {s.n}</span>)}</div>
            </div>
          ))}
          <h3 style={{ marginTop: 14 }}>🌍 Skills by region</h3>
          {t.skillsByRegion.map((d) => (
            <div key={d.region} style={{ marginBottom: 10 }}>
              <div className="small"><b>{d.region}</b></div>
              <div className="row">{d.skills.map((s) => <span key={s.key} className={`badge ${mine.has(s.key) ? 'b-ok' : 'b-dom'}`}>{s.key} · {s.n}</span>)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
