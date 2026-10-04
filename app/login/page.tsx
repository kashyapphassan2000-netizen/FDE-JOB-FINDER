'use client';
import { useEffect, useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'email' | 'password'>('email');
  useEffect(() => { if (new URLSearchParams(location.search).get('e') === 'link') setErr('That sign-in link is expired, already used, or your access was removed.'); }, []);
  async function submitPw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    setBusy(false);
    if (r.ok) window.location.href = '/';
    else setErr((await r.json().catch(() => ({}))).error || 'Login failed');
  }
  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(''); setNote('');
    const r = await fetch('/api/auth/magic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    setBusy(false);
    setNote((await r.json().catch(() => ({}))).note || 'Check your inbox.');
  }
  return (
    <div className="wrap">
      <div className="panel login">
        <div className="brand" style={{ padding: '0 0 14px' }}><div className="brand-mark">F</div><div><b>FDE Job Finder</b><small>private · invite only</small></div></div>
        <span className="seg" style={{ marginBottom: 12 }}>
          <button className={mode === 'email' ? 'on' : ''} onClick={() => setMode('email')}>Email link</button>
          <button className={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>Owner password</button>
        </span>
        {mode === 'email' ? (
          <form onSubmit={submitEmail}>
            <p className="muted small">Enter the email the owner gave access to. You get a one-time sign-in link — no password needed.</p>
            <input type="email" autoFocus placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
            <button className="primary" disabled={busy || !email} style={{ width: '100%' }}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          </form>
        ) : (
          <form onSubmit={submitPw}>
            <p className="muted small">Owner password (can be changed in Settings → Access).</p>
            <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
            <button className="primary" disabled={busy || !pw} style={{ width: '100%' }}>{busy ? 'Checking…' : 'Unlock'}</button>
          </form>
        )}
        {note && <div className="notice ok" style={{ marginTop: 10 }}>{note}</div>}
        {err && <div className="notice err" style={{ marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  );
}
