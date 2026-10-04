'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';
import type { ReferralReport, Person } from '@/lib/referrals';

type Item = { id: string; at: string; company: string; role: string; people: number };
const GROUP: Record<Person['group'], string> = { recruiter: '🎯 Recruiters / talent', manager: '🧭 Hiring managers & leaders', referrer: '🤝 Engineers who can refer you' };
const CONF: Record<string, string> = { verified: 'b-ok', found: 'b-ok', guess: 'b-warn' };

export default function ReferralsTab({ toast, seed }: { toast: (s: string) => void; seed?: { company: string; role: string; n: number } | null }) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [r, setR] = useState<ReferralReport | null>(null);
  const [list, setList] = useState<Item[]>([]);
  const load = useCallback(() => api<{ list: Item[] }>('/api/referrals').then((d) => setList(d.list)).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (seed) { setCompany(seed.company); setRole(seed.role); } }, [seed]);
  useEffect(() => { if (!busy) return; setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [busy]);

  async function run() {
    setBusy(true);
    try { const d = await api<{ report: ReferralReport }>('/api/referrals', { method: 'POST', body: JSON.stringify({ company, role }) }); setR(d.report); load(); toast(d.report.log[0] || 'Done'); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast('Copied'); };

  return (
    <>
      <div className="hero">
        <div>
          <h2>Recruiters & referrals</h2>
          <p>Type a company (and the role). The app finds real people there from public LinkedIn and web results — recruiters, hiring managers and engineers who can refer you — with their work email where it can be found (or guessed from the company’s email pattern, clearly marked), and writes the exact messages from your CV: who to ask first, the connection note, the referral ask, recruiter and manager emails, follow-ups.</p>
        </div>
      </div>
      <div className="panel row">
        <input className="grow big" placeholder="Company name or website — e.g. Sarvam AI, databricks.com" value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && company.trim() && run()} />
        <input className="grow" placeholder="Role (optional) — e.g. Forward Deployed Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
        <button className="primary" disabled={busy || !company.trim()} onClick={run}>{busy ? `Finding people… ${secs}s` : '🔎 Find recruiters & referrers'}</button>
      </div>
      <div className="small muted" style={{ margin: '-6px 0 12px' }}>Honest: a referral can never be guaranteed — this gets you to the right people with the best possible ask. “guess” emails follow the company’s pattern and may bounce; LinkedIn messages always work.</div>

      {r && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>{r.company} <span className="small muted">{r.domain} · {r.role} · {ago(r.at)} ago</span></h3>
            <span className="grow" />
            <ExportButton title={`Recruiters & referrals — ${r.company}`} filename={`referrals-${r.company}`} subtitle={`${r.role} · ${r.log[0] || ''}`}
              sections={[
                { title: 'People', headers: ['Name', 'Title', 'Group', 'Email', 'Email confidence', 'Profile'], rows: r.people.map((p) => [p.name, p.title, p.group, p.email || '', p.emailConfidence || '', p.url]) },
                { title: 'Hiring inboxes', headers: ['Email', 'Confidence'], rows: r.inboxes.map((i) => [i.email, i.confidence]) },
                { title: 'Who to ask, in order', headers: ['Step', 'Who', 'Why'], rows: (r.kit?.ladder || []).map((l) => [l.step, l.who, l.why]) },
                { title: 'Messages', text: (r.kit?.messages || []).map((m) => `${m.kind}${m.to ? ` → ${m.to}` : ''}:\n${m.text}`).join('\n\n') },
                { title: 'Make it easy for the referrer', text: (r.kit?.makeItEasy || []).map((x) => `• ${x}`).join('\n') },
                { title: 'Hacks', text: (r.kit?.hacks || []).map((x) => `• ${x}`).join('\n') },
              ]} />
          </div>
          {r.inboxes.length > 0 && <div className="notice ok small"><b>Hiring inboxes:</b> {r.inboxes.map((i) => <span key={i.email} className="badge b-ok" style={{ cursor: 'pointer' }} onClick={() => copy(i.email)}>{i.email}</span>)}</div>}
          {(['recruiter', 'manager', 'referrer'] as const).map((g) => {
            const ps = r.people.filter((p) => p.group === g);
            if (!ps.length) return null;
            return (
              <div key={g} className="panel">
                <h3>{GROUP[g]} <span className="muted small">{ps.length}</span></h3>
                <div className="grid2">{ps.map((p) => (
                  <div key={p.name} className="card">
                    <div className="row" style={{ justifyContent: 'space-between' }}><b>{p.name}</b>{p.url && <a className="small" href={p.url} target="_blank" rel="noreferrer">profile ↗</a>}</div>
                    <div className="small muted">{p.title}</div>
                    {p.email && <div className="row small" style={{ marginTop: 4 }}><span className="mono">{p.email}</span><span className={`badge ${CONF[p.emailConfidence || 'guess']}`}>{p.emailConfidence}</span><button className="small-btn" onClick={() => copy(p.email!)}>Copy</button></div>}
                  </div>
                ))}</div>
              </div>
            );
          })}
          {!r.people.length && <div className="empty">No people found on public pages. Use the LinkedIn searches below — they open the exact people search.</div>}
          {r.kit && (
            <div className="grid2">
              <div className="panel">
                <h3>🪜 Who to ask, in order</h3>
                {r.kit.ladder.map((l, i) => <div key={i} className="tline small"><b>{l.step}. {l.who}</b> — {l.why}</div>)}
                <h3>🎁 Make it easy for them</h3><ul className="ana-list">{r.kit.makeItEasy.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <h3>💡 Hacks</h3><ul className="ana-list">{r.kit.hacks.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <h3>🔗 Searches</h3><div className="row">{r.kit.searches.map((s) => <a key={s.url} className="pill link-pill" href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>)}</div>
              </div>
              <div className="panel">
                <h3>✉️ Messages (from your CV)</h3>
                {r.kit.messages.map((m, i) => <details key={i} className="ana-q" open={i < 2}><summary>{m.kind}{m.to ? ` → ${m.to}` : ''}</summary><pre className="ana-msg">{m.text}</pre><button className="small-btn" onClick={() => copy(m.text)}>Copy</button></details>)}
              </div>
            </div>
          )}
        </>
      )}

      {list.length > 0 && (
        <div className="panel">
          <h3>Earlier searches</h3>
          {list.map((x) => <div key={x.id} className="row tline"><a style={{ cursor: 'pointer' }} onClick={() => api<{ report: ReferralReport }>(`/api/referrals?id=${x.id}`).then((d) => setR(d.report))}><b>{x.company}</b> · {x.role}</a><span className="badge b-dom">{x.people} people</span><span className="small muted">{ago(x.at)} ago</span><span className="grow" /><button className="small-btn danger" onClick={() => api('/api/referrals', { method: 'DELETE', body: JSON.stringify({ id: x.id }) }).then(load)}>Delete</button></div>)}
        </div>
      )}
    </>
  );
}
