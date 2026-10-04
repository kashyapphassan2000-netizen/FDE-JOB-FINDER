'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';

type Member = { email: string; role: 'owner' | 'member'; addedAt: string; addedBy: string; lastSeen?: string };
type Payload = { members: Member[]; lockdown: boolean; owners: string[]; you: string; ownersConfigured: boolean };

export default function AccessPanel({ toast }: { toast: (s: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [invite, setInvite] = useState('');
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
      {d.lockdown && (
        <div className="notice warn">
          <b>🔒 Lockdown is ON — nobody except the owners can get in.</b> The people you added below are blocked and cannot get an invite link.
          <div style={{ marginTop: 8 }}><button className="primary small-btn" onClick={() => act({ action: 'lockdown', on: false }, 'Lockdown off — the people you added can sign in now')}>Turn lockdown off & let them in</button></div>
        </div>
      )}
      <div className="row">
        <input className="grow" type="email" placeholder="friend@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="primary" disabled={!email} onClick={() => act({ action: 'add', email }, d.lockdown ? `Added ${email} — but lockdown is ON, so they can't get in until you turn it off` : `Access given to ${email} — now click 🔗 Invite link and send it to them`).then(() => setEmail(''))}>Give access</button>
      </div>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Last active</th><th>Action</th></tr></thead>
          <tbody>
            {d.members.map((m) => (
              <tr key={m.email}>
                <td>{m.email}</td>
                <td><span className={`badge ${m.role === 'owner' ? 'b-FDE' : 'b-skip'}`}>{m.role}</span>{m.role !== 'owner' && d.lockdown && <span className="badge b-err">blocked by lockdown</span>}</td>
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
      {invite && <div className="notice ok small" style={{ wordBreak: 'break-all' }}><b>Invite link copied</b> — send it to them on WhatsApp / email. It works once, for 7 days, and signs them in for 30 days: {invite}</div>}
      <div className="small muted" style={{ marginTop: 8 }}><b>How to give someone access:</b> 1) type their email → Give access · 2) click 🔗 Invite link on their row · 3) send them the link. (If Gmail is set up in AI &amp; Keys they can also use “Email link” on the login page themselves.)</div>
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
