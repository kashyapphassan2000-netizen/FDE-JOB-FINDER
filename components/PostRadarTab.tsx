'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';
import { ReachButton, SaveButton } from './ReachButton';

type Config = { enabled: boolean; roles: string[]; places: string[]; keywords: string[]; exclude: string[]; platforms: ('x' | 'li')[]; maxAgeDays: number; batch: number; email: string; allowUnstated: boolean };
type Post = { id: string; platform: 'x' | 'li'; url: string; author: string; text: string; postedAt: string | null; foundAt: string; roles: string[]; place: string; emails: string[]; links: string[]; sent: boolean; ai?: { role: string; company: string; location: string; mode: string; experience: string; salary: string; apply: string; summary: string } };
type Contact = { email: string; who: string; company: string; platform: 'x' | 'li'; sourceUrl: string; context: string; foundAt: string; postedAt: string | null };
type State = { config: Config; meta: { lastRun?: string; lastLog?: string[]; lastEmail?: string; sentTotal: number; scanned: number }; pending: number; total: number; posts: Post[]; contacts: Contact[]; free: boolean };

const join = (x: string[]) => x.join(', ');
const split = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** X + LinkedIn hiring posts by anyone, for your roles + places — scanned every hour, emailed every 100. */
export default function PostRadarTab({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<State | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<'posts' | 'contacts' | 'settings'>('posts');
  const [pf, setPf] = useState<'' | 'x' | 'li'>('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [q, setQ] = useState('');
  const load = useCallback(() => api<State>('/api/postwatch').then((s) => {
    setD(s);
    setF({ roles: join(s.config.roles), places: join(s.config.places), keywords: join(s.config.keywords), exclude: join(s.config.exclude), batch: String(s.config.batch), maxAgeDays: String(s.config.maxAgeDays), email: s.config.email });
  }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  const post = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try { const r = await api<{ log?: string[]; note?: string; newPosts?: number }>('/api/postwatch', { method: 'POST', body: JSON.stringify(body) }); toast(r.note || (r.log ? r.log.join(' · ') : 'Saved')); await load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  };
  const shown = useMemo(() => (d?.posts || []).filter((p) => (!pf || p.platform === pf) && (!onlyNew || !p.sent) && (!q || `${p.text} ${p.author}`.toLowerCase().includes(q.toLowerCase()))), [d, pf, onlyNew, q]);
  if (!d) return <div className="panel muted">Loading radar…</div>;
  const c = d.config;
  return (
    <>
      <div className="hero">
        <div>
          <h2>🎯 Hiring post radar — X + LinkedIn</h2>
          <p>Posts by <b>anyone</b> (founders, engineers, recruiters) hiring for <b>{c.roles.slice(0, 4).join(', ')}{c.roles.length > 4 ? '…' : ''}</b> in <b>{c.places.join(' / ')}</b>. Scanned every hour, only posts from the last {c.maxAgeDays * 24} h, each opened at the source (exact text + time), checked by AI (real opening for your roles?) with role / company / place / experience / how-to-apply extracted, emailed to <b>{c.email || '— set your email'}</b> every <b>{c.batch}</b> new posts — a post is never emailed twice. {d.free ? 'Search: your SearXNG (free, unlimited).' : 'Search: free-tier engines (add SearXNG in Unlimited setup for unlimited).'}</p>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button className="primary" disabled={!!busy} onClick={() => post({ action: 'scan' }, 'scan')}>{busy === 'scan' ? 'Scanning X + LinkedIn… (1–3 min)' : '⚡ Scan now'}</button>
            <button disabled={!!busy || !d.pending} onClick={() => post({ action: 'email' }, 'email')}>{busy === 'email' ? 'Sending…' : `📧 Email me the ${d.pending} new now`}</button>
            <button className="small-btn" onClick={() => setView('settings')}>⚙ Roles, places, email</button>
          </div>
        </div>
        <div className="hero-stats">
          <div><b>{d.pending}/{c.batch}</b><span>until next email</span></div>
          <div><b>{d.contacts.length}</b><span>contact emails</span></div>
          <div><b>{d.meta.lastRun ? ago(d.meta.lastRun) : '—'}</b><span>last scan</span></div>
        </div>
      </div>
      {d.meta.lastLog?.length ? <div className="small muted" style={{ margin: '0 0 8px' }}>Last scan: {d.meta.lastLog.join(' · ')}{d.meta.lastEmail ? ` · last email ${ago(d.meta.lastEmail)} ago (${d.meta.sentTotal} posts sent in total)` : ''}</div> : null}
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <span className={`chip ${view === 'posts' ? 'on' : ''}`} onClick={() => setView('posts')}>Posts · {d.total}</span>
        <span className={`chip ${view === 'contacts' ? 'on' : ''}`} onClick={() => setView('contacts')}>📧 Hiring contacts · {d.contacts.length}</span>
        <span className={`chip ${view === 'settings' ? 'on' : ''}`} onClick={() => setView('settings')}>⚙ My radar settings</span>
      </div>

      {view === 'settings' && (
        <div className="panel">
          <p className="small muted" style={{ marginTop: 0 }}>Comma separated. Add anything now or later — new roles, domains, companies, tech words — the next scan uses it. Your settings are private to you.</p>
          {([['roles', 'Roles to catch (any field)', 'forward deployed engineer, AI engineer, ML engineer…'], ['places', 'Places OK for you', 'Bengaluru, Bangalore, remote, India'], ['keywords', 'Extra things to catch (domains, companies, tech)', 'e.g. voice AI, robotics, Sarvam, RAG, agents'], ['exclude', 'Never show posts containing', 'intern, unpaid, US citizens only'], ['email', 'Email the batches to', 'you@gmail.com']] as const).map(([k, label, ph]) => (
            <label key={k} className="small" style={{ display: 'block', marginBottom: 8 }}><b>{label}</b><textarea rows={k === 'roles' || k === 'keywords' ? 2 : 1} style={{ width: '100%' }} placeholder={ph} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="small">Email every <input type="number" min={10} max={500} style={{ width: 70 }} value={f.batch || ''} onChange={(e) => setF({ ...f, batch: e.target.value })} /> new posts</label>
            <label className="small">Posts from the last <input type="number" min={1} max={30} style={{ width: 55 }} value={f.maxAgeDays || ''} onChange={(e) => setF({ ...f, maxAgeDays: e.target.value })} /> days</label>
            <label className="small"><input type="checkbox" checked={c.allowUnstated} onChange={(e) => post({ action: 'save', config: { allowUnstated: e.target.checked } }, 'save')} /> include posts that state no place (strict = off)</label>
            <label className="small"><input type="checkbox" checked={c.platforms.includes('x')} onChange={(e) => post({ action: 'save', config: { platforms: e.target.checked ? [...c.platforms, 'x'] : c.platforms.filter((x) => x !== 'x') } }, 'save')} /> X</label>
            <label className="small"><input type="checkbox" checked={c.platforms.includes('li')} onChange={(e) => post({ action: 'save', config: { platforms: e.target.checked ? [...c.platforms, 'li'] : c.platforms.filter((x) => x !== 'li') } }, 'save')} /> LinkedIn</label>
            <label className="small"><input type="checkbox" checked={c.enabled} onChange={(e) => post({ action: 'save', config: { enabled: e.target.checked } }, 'save')} /> hourly scans on</label>
          </div>
          <button className="primary" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => post({ action: 'save', config: { roles: split(f.roles || ''), places: split(f.places || ''), keywords: split(f.keywords || ''), exclude: split(f.exclude || ''), email: f.email, batch: Number(f.batch), maxAgeDays: Number(f.maxAgeDays) } }, 'save')}>{busy === 'save' ? 'Saving…' : 'Save my radar'}</button>
        </div>
      )}

      {view === 'contacts' && (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="small muted" style={{ margin: 0 }}>Every email address written in a hiring post the radar saved — with the exact post it came from. Public info the poster shared to be contacted; use it for that.</p>
            {d.contacts.length > 0 && <ExportButton title="Hiring contacts (from posts)" sections={[{ title: 'Contacts', headers: ['Email', 'Who posted', 'Company', 'Platform', 'Post date', 'Source post', 'Context'], rows: d.contacts.map((x) => [x.email, x.who, x.company, x.platform === 'x' ? 'X' : 'LinkedIn', (x.postedAt || '').slice(0, 10), x.sourceUrl, x.context]) }]} />}
          </div>
          {!d.contacts.length && <div className="small muted" style={{ marginTop: 8 }}>None yet — they appear as soon as a matching post lists an email.</div>}
          {d.contacts.map((x) => (
            <div key={x.email} className="tline small"><b><a href={`mailto:${x.email}`}>{x.email}</a></b> — {x.who || 'poster'}{x.company ? ` · ${x.company}` : ''} <span className="muted">· {x.platform === 'x' ? 'X' : 'LinkedIn'} · {x.postedAt ? `posted ${ago(x.postedAt)} ago` : ''}</span> · <a href={x.sourceUrl} target="_blank" rel="noreferrer">source post ↗</a><div className="muted">“…{x.context}…”</div></div>
          ))}
        </div>
      )}

      {view === 'posts' && (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {(['', 'x', 'li'] as const).map((k) => <span key={k || 'all'} className={`chip ${pf === k ? 'on' : ''}`} onClick={() => setPf(k)}>{k === '' ? 'All' : k === 'x' ? '𝕏 X' : 'in LinkedIn'} · {(d.posts || []).filter((p) => !k || p.platform === k).length}</span>)}
            <label className="small"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> only not-yet-emailed</label>
            <input placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="grow" />
            {shown.length > 0 && <ExportButton title="Hiring posts (X + LinkedIn)" sections={[{ title: 'Posts', headers: ['Posted', 'Platform', 'Author', 'Roles', 'Place', 'Emails', 'Text', 'Link'], rows: shown.map((p) => [(p.postedAt || '').slice(0, 16), p.platform === 'x' ? 'X' : 'LinkedIn', p.author, p.roles.join(', '), p.place, p.emails.join(' '), p.text.slice(0, 600), p.url]) }]} />}
          </div>
          {!shown.length && <div className="panel small muted">No posts yet — press ⚡ Scan now. The radar also runs by itself every hour.</div>}
          {shown.map((p) => (
            <div key={p.id} className="panel" style={{ padding: 12, marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><b>{p.platform === 'x' ? '𝕏' : 'in'} {p.author || 'post'}</b> <span className="small muted">· {p.postedAt ? `${ago(p.postedAt)} ago` : ''} · {p.roles.join(', ')} · 📍 {p.place}{p.sent ? ' · ✉ emailed' : ' · 🆕'}</span></span>
                <button className="small-btn danger" onClick={() => post({ action: 'delete', id: p.id }, 'del')}>✕</button>
              </div>
              {p.ai && <div className="notice small" style={{ margin: '6px 0' }}>🤖 <b>{p.ai.role}</b>{p.ai.company ? <> @ <b>{p.ai.company}</b></> : null}{[p.ai.location, p.ai.mode, p.ai.experience, p.ai.salary].filter(Boolean).map((x) => ` · ${x}`).join('')}<div>{p.ai.summary}</div>{p.ai.apply && <div><b>Apply:</b> {p.ai.apply}</div>}</div>}
              <div className="small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{p.text.slice(0, 900)}{p.text.length > 900 ? '…' : ''}</div>
              {p.emails.length > 0 && <div className="small">📧 {p.emails.map((e) => <a key={e} href={`mailto:${e}`} style={{ marginRight: 8 }}>{e}</a>)}</div>}
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <a className="btn primary small-btn" href={p.url} target="_blank" rel="noreferrer">Open post ↗</a>
                <ReachButton item={{ title: p.roles[0] || 'role', url: p.url, text: p.text, author: p.author }} toast={toast} />
                <SaveButton item={{ title: `${p.roles[0] || 'Hiring post'} — ${p.author}`, url: p.url, text: p.text, author: p.author }} toast={toast} />
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
