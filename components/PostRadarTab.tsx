'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';
import { ReachButton, SaveButton } from './ReachButton';
import CaptureButton from './CaptureButton';

type Config = { enabled: boolean; roles: string[]; places: string[]; keywords: string[]; exclude: string[]; platforms: ('x' | 'li')[]; maxAgeDays: number; batch: number; email: string; allowUnstated: boolean };
type Post = { id: string; platform: 'x' | 'li'; url: string; author: string; text: string; postedAt: string | null; foundAt: string; roles: string[]; place: string; emails: string[]; links: string[]; sent: boolean; ai?: { role: string; company: string; location: string; mode: string; experience: string; salary: string; apply: string; summary: string } };
type Contact = { email: string; who: string; company: string; platform: 'x' | 'li'; sourceUrl: string; context: string; foundAt: string; postedAt: string | null };
type State = { config: Config; meta: { lastRun?: string; lastLog?: string[]; lastEmail?: string; sentTotal: number; scanned: number }; pending: number; total: number; posts: Post[]; contacts: Contact[]; free: boolean; apify?: { on: boolean; cap: number; spent: number; left: number; pool: number; owner: boolean } };

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
      <div className={`notice ${d.apify?.on ? 'ok' : 'warn'} small`} style={{ marginBottom: 10 }}>
        {d.apify?.on ? <>🟢 <b>LIVE X + LinkedIn posts via Apify is ON</b> — X every 6 h, LinkedIn every 12 h, posts minutes old, no login. {d.apify.pool} live posts in the pool · credit used this month ${d.apify.spent} of ${d.apify.cap} (free $5/month). {d.apify.owner && <button className="small-btn primary" disabled={!!busy} onClick={() => post({ action: 'live-now' }, 'live')}>{busy === 'live' ? 'Fetching live X + LinkedIn… (1–3 min)' : '⚡ Fetch live posts now'}</button>}</>
          : <>🔴 <b>Live X + LinkedIn posts are OFF.</b> Free search engines only see posts hours–days late — that is why the 24 h list is empty. Fix in 2 minutes, free: <b>apify.com → Sign up (Google login, no card) → Settings → API &amp; Integrations → copy the Personal API token → paste it as <code>APIFY_TOKEN</code> in Setup → Unlimited setup (or AI &amp; Keys)</b>. Apify gives $5 credit every month; the radar stays under it automatically.</>}
      </div>
      <div className="panel" style={{ marginBottom: 10 }}>
        <b>⚡ Truly live (last minutes), free, unlimited — from your own logged-in X / LinkedIn:</b>
        <p className="small muted" style={{ margin: '4px 0 8px' }}>Search engines see X / LinkedIn posts hours to days late — no free server can read them live. Your browser can: open a live search below (already sorted newest + last 24 h), scroll, click <b>📥 Capture</b> in your bookmarks bar. Every post on the page is read exactly (link, time, author, text), AI-checked, extracted and added here (never twice; counts toward your {c.batch}-post email). It only reads what you are looking at — no bot, no auto-scrolling, so your account is safe.</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <a className="btn primary small-btn" target="_blank" rel="noreferrer" href={`https://x.com/search?q=${encodeURIComponent(`(${c.roles.slice(0, 6).map((r) => (/\s/.test(r) ? `"${r}"` : r)).join(' OR ')}) (hiring OR "we're hiring" OR "join us" OR "DM me") -is:retweet`)}&f=live`}>𝕏 Live: all my roles</a>
          {c.roles.slice(0, 5).map((r) => <a key={r} className="small-btn" target="_blank" rel="noreferrer" href={`https://x.com/search?q=${encodeURIComponent(`"${r}" hiring ${c.places.some((p) => /bangalore|bengaluru/i.test(p)) ? '(bangalore OR bengaluru OR remote)' : ''} -is:retweet`)}&f=live`}>𝕏 {r}</a>)}
          {c.roles.slice(0, 5).map((r) => <a key={`li-${r}`} className="small-btn" target="_blank" rel="noreferrer" href={`https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(`hiring ${r}`)}&datePosted=%22past-24h%22&sortBy=%22date_posted%22`}>in {r} · 24 h</a>)}
        </div>
        <div style={{ marginTop: 8 }}><CaptureButton compact /></div>
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
