'use client';
import { useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    setBusy(false);
    if (r.ok) window.location.href = '/';
    else setErr((await r.json().catch(() => ({}))).error || 'Login failed');
  }
  return (
    <div className="wrap">
      <form className="panel login" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 12 }}>🔎 FDE Job Finder <small>private</small></div>
        <p className="muted small">Owner-only dashboard. Enter the APP_PASSWORD you set on Vercel.</p>
        <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
        <button className="primary" disabled={busy || !pw} style={{ width: '100%' }}>{busy ? 'Checking…' : 'Unlock'}</button>
        {err && <div className="notice err" style={{ marginTop: 10 }}>{err}</div>}
      </form>
    </div>
  );
}
