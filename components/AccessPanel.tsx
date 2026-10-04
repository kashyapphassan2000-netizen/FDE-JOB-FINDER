'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';

type Member = { email: string; role: 'owner' | 'member'; addedAt: string; addedBy: string; lastSeen?: string; expiresAt?: string | null; usedToday?: number; agents?: number; limits?: { actionsPerDay?: number; maxAgents?: number } };
type Limits = { maxMembers: number; maxTimed: number; actionsPerDay: number; maxAgents: number; minScheduleHours: number };
const DURATIONS: [number, string][] = [[1, '1 hour'], [2, '2 hours'], [6, '6 hours'], [12, '12 hours'], [24, '24 hours'], [72, '3 days'], [168, '7 days'], [720, '30 days'], [0, 'Permanent']];
const left = (iso?: string | null) => { if (!iso) return null; const ms = Date.parse(iso) - Date.now(); if (ms <= 0) return 'expired'; const h = ms / 36e5; return h < 1 ? `${Math.max(1, Math.round(ms / 6e4))} min left` : h < 48 ? `${Math.round(h)} h left` : `${Math.round(h / 24)} days left`; };
type Payload = { relays: { email: string; code: string; minutesLeft: number }[]; mailer: { canEmailAnyone: boolean; gmail: boolean; brevo: boolean; resend: boolean }; members: Member[]; limits: Limits; lockdown: boolean; owners: string[]; you: string; ownersConfigured: boolean };

export default function AccessPanel({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [invite, setInvite] = useState('');
  const [hours, setHours] = useState(0);
  const load = useCallback(() => api<Payload>('/api/access').then(setD).catch(() => setDenied(true)), []);
  useEffect(() => { load(); }, [load]);
  async function act(body: Record<string, unknown>, ok: string) {
    try {
      const r = await api<{ link?: string; note?: string }>('/api/access', { method: 'POST', body: JSON.stringify(body) });
      if (r.link) { setInvite(r.link); await navigator.clipboard.writeText(r.link).catch(() => null); }
      toast(r.note || ok);
      if (body.action === 'password') setTimeout(() => (window.location.href = '/login'), 1200);
      else load();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (denied) return <div className="panel"><h3 style={{ marginTop: 0 }}>Access</h3><p className="muted small">Only owners can manage access.</p></div>;
  if (!d) return <div className="panel muted">Loading access…</div>;
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>🔐 Access — who can open this app</h3>
      {!d.ownersConfigured && <div className="notice warn small">OWNER_EMAILS is not set on Vercel, so only the password works as owner.</div>}
      <p className="small muted">Owners (fixed for security): <b>{d.owners.join(', ') || '—'}</b>. People you add sign in with a one-time link to their own email (or an invite link you send them) — you never share the password. Removing someone or locking down takes effect immediately.</p>
      {!d.mailer.canEmailAnyone && (
        <div className="notice warn small">
          <b>📭 Your users do NOT receive sign-in codes by email yet</b> — the app can only email <b>you</b> (Resend test mode). Until you fix it, every code a user asks for is sent to <b>you</b> (your email{''} + WhatsApp if connected) and shown below — pass it on, or send them a 🔗 Invite link.
          <div style={{ marginTop: 6 }}><b>Fix in 3 minutes:</b> Google Account → Security → turn on 2-Step Verification → search “App passwords” → create one → in <b>AI &amp; Keys → Access</b> paste <code>GMAIL_USER</code> (your Gmail) and <code>GMAIL_APP_PASSWORD</code> (the 16 letters). Or set up Google sign-in (no email needed): GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.</div>
        </div>
      )}
      {d.relays.length > 0 && (
        <div className="notice ok small"><b>🔐 Sign-in codes waiting for you to pass on:</b>{d.relays.map((r) => <div key={r.email}>{r.email}: <b style={{ fontSize: 18, letterSpacing: 3 }}>{r.code}</b> <span className="muted">({r.minutesLeft} min left)</span> <button className="small-btn" onClick={() => navigator.clipboard.writeText(`Your FDE Job Finder sign-in code: ${r.code}`).then(() => toast('Copied — send it to them'))}>Copy</button></div>)}</div>
      )}
      {d.lockdown && (
        <div className="notice warn">
          <b>🔒 Lockdown is ON — nobody except the owners can get in.</b> The people you added below are blocked and cannot get an invite link.
          <div style={{ marginTop: 8 }}><button className="primary small-btn" onClick={() => act({ action: 'lockdown', on: false }, 'Lockdown off — the people you added can sign in now')}>Turn lockdown off & let them in</button></div>
        </div>
      )}
      <div className="row">
        <input className="grow" type="email" placeholder="friend@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} title="How long this person can use the app">{DURATIONS.map(([h, l]) => <option key={h} value={h}>Access for: {l}</option>)}</select>
        <button className="primary" disabled={!email} onClick={() => act({ action: 'add', email, hours: hours || null }, d.lockdown ? `Added ${email} — but lockdown is ON, so they can't get in until you turn it off` : `Access given to ${email} — now click 🔗 Invite link and send it to them`).then(() => setEmail(''))}>Give access</button>
      </div>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Access</th><th>AI today</th><th>Last active</th><th>Action</th></tr></thead>
          <tbody>
            {d.members.map((m) => (
              <tr key={m.email}>
                <td>{m.email}</td>
                <td><span className={`badge ${m.role === 'owner' ? 'b-FDE' : 'b-skip'}`}>{m.role}</span>{m.role !== 'owner' && d.lockdown && <span className="badge b-err">blocked by lockdown</span>}</td>
                <td className="small">{m.role === 'owner' ? 'always' : m.expiresAt ? <span className={`badge ${left(m.expiresAt) === 'expired' ? 'b-err' : 'b-warn'}`} title={new Date(m.expiresAt).toLocaleString('en-IN')}>⏱ {left(m.expiresAt)}</span> : <span className="badge b-ok">permanent</span>}
                  {m.role !== 'owner' && <select className="small" style={{ marginLeft: 6, padding: '2px 6px' }} value="" onChange={(e) => e.target.value && act({ action: 'expiry', email: m.email, hours: Number(e.target.value) > 0 ? Number(e.target.value) : null }, Number(e.target.value) > 0 ? `Access for ${m.email}: ${DURATIONS.find(([h]) => h === Number(e.target.value))?.[1]} from now` : `${m.email} now has permanent access`)}><option value="">{m.expiresAt ? 'Extend…' : 'Limit…'}</option>{DURATIONS.map(([h, l]) => <option key={h} value={h || -1}>{h ? `${l} from now` : 'Make permanent'}</option>)}</select>}
                </td>
                <td className="small">{m.role === 'owner' ? 'unlimited' : <>
                  <b>{m.usedToday || 0}</b>/{m.limits?.actionsPerDay ?? d.limits.actionsPerDay} · {m.agents || 0}/{m.limits?.maxAgents ?? d.limits.maxAgents} agents
                  <button className="small-btn" style={{ marginLeft: 4 }} title="Give this person a different daily limit / agent count" onClick={() => { const a = window.prompt(`AI actions per day for ${m.email} (empty = default ${d.limits.actionsPerDay})`, String(m.limits?.actionsPerDay ?? '')); if (a === null) return; const g = window.prompt(`Max custom agents (empty = default ${d.limits.maxAgents})`, String(m.limits?.maxAgents ?? '')); if (g === null) return; act({ action: 'member-limits', email: m.email, memberLimits: { actionsPerDay: a === '' ? null : Number(a), maxAgents: g === '' ? null : Number(g) } }, 'Limits updated'); }}>✎</button></>}</td>
                <td className="small">{m.lastSeen ? ago(m.lastSeen) : '—'}</td>
                <td><div className="row">
                  <button className="small-btn" disabled={d.lockdown && m.role !== 'owner'} title={d.lockdown && m.role !== 'owner' ? 'Turn lockdown off first' : 'Copy a one-time sign-in link to send them'} onClick={() => act({ action: 'invite', email: m.email }, 'Invite link copied')}>🔗 Invite link</button>
                  {m.role !== 'owner' && <button className="small-btn danger" onClick={() => window.confirm(`Remove access for ${m.email}?`) && act({ action: 'remove', email: m.email }, 'Access removed')}>Remove</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="st-box" style={{ marginTop: 12 }}>
        <b>⚖ Limits</b> <span className="small muted">— keeps your free AI / search quota safe. You (owner) are never limited.</span>
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {([['maxMembers', 'Max people with access'], ['maxTimed', 'Max time-limited guests'], ['actionsPerDay', 'AI actions / person / day'], ['maxAgents', 'Custom agents / person'], ['minScheduleHours', 'Their agents run at most every (h)']] as [keyof Limits, string][]).map(([k, l]) => (
            <label key={k} className="small">{l}<br /><input type="number" min={0} style={{ width: 110 }} defaultValue={d.limits[k]} onBlur={(e) => Number(e.target.value) !== d.limits[k] && act({ action: 'limits', limits: { [k]: Number(e.target.value) } }, `${l}: ${e.target.value}`)} /></label>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>Seats used: <b>{d.members.filter((m) => m.role !== 'owner' && (!m.expiresAt || Date.parse(m.expiresAt) > Date.now())).length}/{d.limits.maxMembers}</b> · time-limited: <b>{d.members.filter((m) => m.role !== 'owner' && m.expiresAt && Date.parse(m.expiresAt) > Date.now()).length}/{d.limits.maxTimed}</b>. One AI action = one analysis / referral report / mentor message / agent search / agent run. Resets midnight IST.</div>
      </div>
      {invite && <div className="notice ok small" style={{ wordBreak: 'break-all' }}><b>Invite link copied</b> — send it to them on WhatsApp / email. It works once, for 7 days, and signs them in for 30 days: {invite}</div>}
      <div className="small muted" style={{ marginTop: 8 }}><b>How to give someone access:</b> 1) type their email, pick how long (1 hour … permanent) → Give access · 2) click 🔗 Invite link on their row · 3) send them the link. (If Gmail is set up in AI &amp; Keys they can also use “Email link” on the login page themselves.)</div>
      <div className="row" style={{ marginTop: 12 }}>
        <label className="small"><input type="checkbox" checked={d.lockdown} onChange={(e) => window.confirm(e.target.checked ? 'Lockdown: sign everyone out and allow ONLY the owner emails?' : 'Turn lockdown off?') && act({ action: 'lockdown', on: e.target.checked }, e.target.checked ? 'Lockdown on — only owners can get in' : 'Lockdown off')} /> <b>Lockdown</b> — only {d.owners.join(' and ') || 'owners'} can get in (signs everyone else out)</label>
      </div>
      <h4>Change owner password</h4>
      <div className="row">
        <input type="password" placeholder="New password (10+ chars)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input type="password" placeholder="Repeat" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <button disabled={pw.length < 10 || pw !== pw2} onClick={() => window.confirm('Change the password? Everyone will be signed out.') && act({ action: 'password', password: pw }, 'Password changed')}>Change password</button>
      </div>
      <p className="small muted">Sign-in emails to any address need a Gmail app password (AI &amp; Keys → GMAIL_USER + GMAIL_APP_PASSWORD). Without it, use 🔗 Invite link and send it yourself.</p>
    </div>
  );
}
