'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';

type Sub = { id: string; email: string; name?: string; roles: string[]; where: string; city?: string; count: number; maxAgeH: number; exclude?: string[]; active: boolean; lastSent?: string; lastResult?: string; sentTotal: number };
type Mailer = { gmail: boolean; resend: boolean; resendDomain: boolean; canEmailAnyone: boolean };
type Pick = { title: string; company: string; location: string; url: string; source: string; t: number };
const WHERE: Record<string, string> = { city: 'A city / country + remote', remote: 'Remote only', any: 'Anywhere in the world', 'blr-remote': 'Bengaluru office or remote (India)' };
const EMPTY = { email: '', name: '', roles: '', where: 'blr-remote', city: '', count: 10, maxAgeH: 48, exclude: '' };

export default function AlertsTab({ toast, mine = false }: { toast: (s: string) => void; mine?: boolean }) {
  const EP = mine ? '/api/myalerts' : '/api/subscribers';
  const [subs, setSubs] = useState<Sub[]>([]);
  const [mailer, setMailer] = useState<Mailer | null>(null);
  const [f, setF] = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<{ id: string; picks: Pick[] } | null>(null);
  const load = useCallback(() => api<{ subs: Sub[]; mailer: Mailer }>(EP).then((d) => { setSubs(d.subs); setMailer(d.mailer); }).catch((e) => toast(e.message)), [toast, EP]);
  useEffect(() => { load(); }, [load]);
  const set = (k: keyof typeof EMPTY, v: string | number) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy('save');
    try {
      await api(EP, { method: 'POST', body: JSON.stringify({ action: 'save', ...f, roles: f.roles.split(/[,\n]/), exclude: f.exclude.split(/[,\n]/) }) });
      toast(f.id ? 'Updated' : `Added ${f.email} — first email goes out with the next daily run (or press “Send now”)`); setF(EMPTY); load();
    } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function act(s: Sub, action: 'run' | 'preview' | 'delete' | 'toggle') {
    setBusy(`${action}:${s.id}`);
    try {
      if (action === 'toggle') await api(EP, { method: 'POST', body: JSON.stringify({ action: 'save', ...s, active: !s.active }) });
      else if (action === 'delete') { if (!confirm(`Stop and remove alerts for ${s.email}?`)) return; await api(EP, { method: 'POST', body: JSON.stringify({ action, id: s.id }) }); }
      else {
        const r = await api<{ picks: Pick[]; result?: string }>(EP, { method: 'POST', body: JSON.stringify({ action, id: s.id }) });
        if (action === 'preview') setPreview({ id: s.id, picks: r.picks }); else toast(r.result || 'Sent');
      }
      load();
    } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }

  return (
    <>
      <div className="hero">
        <div>
          <h2>{mine ? 'My job alerts' : 'Job alerts for anyone'}</h2>
          {mine ? <p>Get fresh jobs for YOUR roles (any field) in YOUR place (any city, country or remote) emailed every morning — to your email or any email you add (up to 3 alerts). Every live job board, ~230 company boards, LinkedIn and X posts, newest first, nothing sent twice.</p> : <p>Add a friend’s (or client’s) email and the roles they want. Every morning the app runs your full search strategy for them — every live job board, ~230 company boards, X & LinkedIn posts, newest first, nothing sent twice — and emails them the best job links.</p>}
        </div>
        <div className="hero-stats"><div><b>{subs.filter((s) => s.active).length}</b><span>active</span></div><div><b>{subs.reduce((n, s) => n + s.sentTotal, 0)}</b><span>jobs sent</span></div></div>
      </div>
      {mailer && !mailer.canEmailAnyone && (
        <div className="notice warn small"><b>Set up email first:</b> to email other people, add <b>GMAIL_USER</b> + <b>GMAIL_APP_PASSWORD</b> in Setup → AI & Keys (Google account → 2-Step Verification → App passwords). {mailer.resend ? 'Resend is set, but its free test sender only emails your own Resend address.' : ''} You can still add people and preview their jobs now.</div>
      )}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{f.id ? 'Edit' : mine ? 'New alert' : 'Add a person'}</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="grow" type="email" placeholder={mine ? 'Email to send to (empty = your sign-in email)' : 'Their email'} value={f.email} onChange={(e) => set('email', e.target.value)} />
          <input placeholder="Name (optional)" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <textarea className="tabprompt" rows={2} placeholder="Roles they want, comma separated — e.g. Data scientist, ML engineer, AI product manager" value={f.roles} onChange={(e) => set('roles', e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <select value={f.where} onChange={(e) => set('where', e.target.value)}>{Object.entries(WHERE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {f.where === 'city' && <input placeholder="City — e.g. Hyderabad" value={f.city} onChange={(e) => set('city', e.target.value)} />}
          <label className="small">Jobs per email <select value={f.count} onChange={(e) => set('count', +e.target.value)}>{[5, 10, 15, 20, 25].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label className="small">Posted within <select value={f.maxAgeH} onChange={(e) => set('maxAgeH', +e.target.value)}>{[[24, '24 h'], [48, '2 days'], [72, '3 days'], [168, '7 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <input className="grow" placeholder="Exclude words (optional) — e.g. intern, sales" value={f.exclude} onChange={(e) => set('exclude', e.target.value)} />
          <button className="primary" disabled={busy === 'save' || !f.email || !f.roles.trim()} onClick={save}>{f.id ? 'Save' : '＋ Add'}</button>
          {f.id && <button onClick={() => setF(EMPTY)}>Cancel</button>}
        </div>
      </div>

      <div className="grid2">
        {subs.map((s) => (
          <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{s.name || s.email}</b><span className={`badge ${s.active ? 'b-ok' : 'b-skip'}`}>{s.active ? 'active · daily' : 'paused'}</span></div>
            <div className="small muted">{s.email}</div>
            <div style={{ margin: '6px 0' }}>{s.roles.map((r) => <span key={r} className="badge b-FDE">{r}</span>)}</div>
            <div className="small">{WHERE[s.where]}{s.where === 'city' ? ` (${s.city})` : ''} · {s.count} jobs · posted within {s.maxAgeH} h{s.exclude?.length ? ` · excludes: ${s.exclude.join(', ')}` : ''}</div>
            <div className="small muted">{s.lastSent ? `last run ${ago(s.lastSent)} ago — ${s.lastResult}` : 'not sent yet'} · {s.sentTotal} jobs sent in total</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="small-btn" disabled={!!busy} onClick={() => act(s, 'preview')}>{busy === `preview:${s.id}` ? 'Searching…' : '👀 Preview'}</button>
              <button className="small-btn primary" disabled={!!busy} onClick={() => act(s, 'run')}>{busy === `run:${s.id}` ? 'Sending…' : '✉ Send now'}</button>
              <button className="small-btn" onClick={() => setF({ id: s.id, email: s.email, name: s.name || '', roles: s.roles.join(', '), where: s.where, city: s.city || '', count: s.count, maxAgeH: s.maxAgeH, exclude: (s.exclude || []).join(', ') })}>Edit</button>
              <button className="small-btn" onClick={() => act(s, 'toggle')}>{s.active ? 'Pause' : 'Resume'}</button>
              <button className="small-btn danger" onClick={() => act(s, 'delete')}>Remove</button>
            </div>
            {preview?.id === s.id && (
              <div style={{ marginTop: 8 }}>
                <div className="small muted">{preview.picks.length} jobs would be sent now:</div>
                <ol className="small">{preview.picks.map((p) => <li key={p.url}><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> — {p.company} <span className="muted">{p.location} · {p.t ? `${ago(new Date(p.t).toISOString())} ago` : 'open'} · {p.source}</span></li>)}</ol>
              </div>
            )}
          </div>
        ))}
      </div>
      {!subs.length && <div className="empty">No one added yet.</div>}
    </>
  );
}
