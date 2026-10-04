'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ago, api, dateLabel, isStale } from './api';
import ExportButton from './ExportButton';

type Count = { key: string; n: number; change?: number; domain?: string };
type Trends = {
  total: number; jobs: number; posts: number; history: number; regions: Count[]; domains: Count[]; roles: Count[]; rolesThisWeek: Count[]; companies: Count[];
  skills: Count[]; rising: Count[]; newRoles: Count[]; skillsByDomain: { domain: string; skills: Count[] }[]; skillsByRegion: { region: string; skills: Count[] }[];
  yourSkills: { have: string[]; missing: string[]; cvUploaded: boolean };
};
type Report = {
  at: string; model?: string; days?: number; articles?: number; news?: number; summary?: string;
  headlines: { title: string; summary: string; region: string; url: string; date?: string; source?: string }[]; hot_skills: { skill: string; why: string; region: string; url?: string }[];
  new_roles: { role: string; what: string; who_hires: string; url?: string }[]; domains: { domain: string; ai_use_cases: string; companies: string; your_angle: string }[];
  who_hiring?: { company: string; what: string; region: string; url?: string }[]; watch_out?: string[]; your_moves: string[]; sources: { title: string; url: string; date?: string; source?: string }[];
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
  const auto = useRef(false);
  const load = useCallback(() => api<{ trends: Trends; report: Report | null }>('/api/trends').then((d) => { setT(d.trends); setR(d.report); return d; }).catch((e) => { toast(e.message); return null; }), [toast]);
  useEffect(() => {
    load().then((d) => {
      if (!d || auto.current) return;
      auto.current = true;
      if (isStale(d.report?.at, 20)) rebuild(true); // fresh report on open
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  async function rebuild(silent = false) {
    setBusy(true);
    if (!silent) toast('Reading this week’s AI-jobs news in full for India, USA and global (1–2 min)…');
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
          <span className="row">{r && <span className="small muted">updated {ago(r.at)}{r.model ? ` · ${r.model}` : ''}</span>}<button className="primary small-btn" disabled={busy} onClick={() => rebuild()}>{busy ? 'Reading fresh news…' : '🔄 Rebuild now'}</button>
            <ExportButton title="AI jobs market report & trends" subtitle={r ? `${r.summary || ''}\nNews window: last ${r.days || 7} days · ${r.articles || 0} articles read · built ${new Date(r.at).toLocaleString('en-IN')}` : 'Live job-data trends'} filename="trends-report" sections={[
              ...(r ? [
                { title: 'Headlines', headers: ['Date', 'Headline', 'Summary', 'Region', 'Link'], rows: r.headlines.map((h) => [h.date || '', h.title, h.summary, h.region, h.url]) },
                { title: 'Who is hiring (from the news)', headers: ['Company', 'What', 'Region', 'Link'], rows: (r.who_hiring || []).map((h) => [h.company, h.what, h.region, h.url || '']) },
                { title: 'Hot skills', headers: ['Skill', 'Why', 'Region'], rows: r.hot_skills.map((h) => [h.skill, h.why, h.region]) },
                { title: 'New & emerging roles', headers: ['Role', 'What', 'Who hires'], rows: r.new_roles.map((h) => [h.role, h.what, h.who_hires]) },
                { title: 'Domains deploying AI', headers: ['Domain', 'AI use cases', 'Companies', 'Your angle'], rows: r.domains.map((d) => [d.domain, d.ai_use_cases, d.companies, d.your_angle]) },
                { title: 'Watch out', text: (r.watch_out || []).map((w) => `• ${w}`).join('\n') },
                { title: 'Your next moves', text: r.your_moves.map((m, i) => `${i + 1}. ${m}`).join('\n') },
              ] : []),
              { title: `Live job data (${t.total} jobs & posts)`, headers: ['Skill', 'Count'], rows: t.skills.map((x) => [x.key, String(x.n)]) },
              { title: 'Roles being hired', headers: ['Role', 'Count'], rows: t.roles.map((x) => [x.key, String(x.n)]) },
              { title: 'Who is hiring most (your feed)', headers: ['Company', 'Open roles', 'Domain'], rows: t.companies.map((x) => [x.key, String(x.n), x.domain || '']) },
              { title: 'Where', headers: ['Region', 'Count'], rows: t.regions.map((x) => [x.key, String(x.n)]) },
              ...(r ? [{ title: 'Sources', headers: ['Date', 'Source', 'Title', 'Link'], rows: r.sources.map((x) => [x.date || '', x.source || '', x.title, x.url]) }] : []),
            ]} /></span>
        </div>
        {!r && <p className="muted small">{busy ? 'Reading this week’s news in full — the report appears here in 1–2 minutes…' : 'No report yet — click “Rebuild now”.'}</p>}
        {r && (
          <>
            <p className="small muted" style={{ margin: '6px 0 0' }}>Fresh only: news from the last {r.days || 7} days ({r.news || '?'} items, {r.articles || '?'} full articles read), facts extracted then cross-checked against your live job data. Auto-rebuilt daily and whenever older than 20 h.</p>
            {r.summary && <div className="notice ok" style={{ marginTop: 10 }}><b>This week:</b> {r.summary}</div>}
            <div className="grid2" style={{ marginTop: 12 }}>
              {r.headlines.map((h) => (
                <a key={h.url + h.title} className="card news" href={h.url} target="_blank" rel="noreferrer">
                  <span className="badge b-dom">{h.region}</span>{h.date && <span className="badge b-date">{dateLabel(h.date)}</span>}{h.source && <span className="small muted"> {h.source}</span>}
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
            {(r.who_hiring || []).length > 0 && (
              <>
                <h4 style={{ marginTop: 14 }}>🏢 Who is hiring (this week’s news)</h4>
                <div className="grid2">{r.who_hiring!.map((h) => <div key={h.company + h.what} className="tline"><b>{h.company}</b> <span className="badge b-dom">{h.region}</span><div className="small">{h.what} {h.url && <a href={h.url} target="_blank" rel="noreferrer">source ↗</a>}</div></div>)}</div>
              </>
            )}
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
            {(r.watch_out || []).length > 0 && <div className="notice warn" style={{ marginTop: 12 }}><b>Watch out:</b><ul style={{ margin: '6px 0 0' }}>{r.watch_out!.map((m) => <li key={m}>{m}</li>)}</ul></div>}
            {r.your_moves.length > 0 && (
              <div className="notice ok" style={{ marginTop: 12 }}><b>Your next moves:</b><ol style={{ margin: '6px 0 0' }}>{r.your_moves.map((m) => <li key={m}>{m}</li>)}</ol></div>
            )}
            <details className="small"><summary>{r.sources.length} sources</summary><ol>{r.sources.map((s) => <li key={s.url}>{s.date && <span className="muted">{s.date} · {s.source} · </span>}<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ol></details>
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
