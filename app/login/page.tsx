'use client';
import { useEffect, useState } from 'react';

const ERRORS: Record<string, string> = {
  link: 'That sign-in link is expired, already used, or your access was removed.',
  noaccess: 'This Google account has no access. Ask the owner to add exactly this Gmail address.',
  'google-off': 'Google sign-in is not switched on yet — use the email code instead.',
  'google-state': 'Sign-in expired or was tampered with — try again.',
  'google-token': 'Google could not confirm this account — try again.',
  'google-cancel': 'Google sign-in was cancelled.',
  slow: 'Too many attempts — wait a few minutes.',
};

export default function Login() {
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'user' | 'password' | 'request'>('user');
  const [rq, setRq] = useState({ email: '', name: '', role: '', location: '', situation: '' });
  const [opts, setOpts] = useState<{ google: boolean; otp: boolean } | null>(null);
  useEffect(() => {
    const e = new URLSearchParams(location.search).get('e');
    if (e) setErr(ERRORS[e] || 'Sign-in failed — try again.');
    fetch('/api/auth/options').then((r) => r.json()).then(setOpts).catch(() => setOpts({ google: false, otp: false }));
  }, []);
  const post = async (url: string, body: unknown) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { ok: r.ok, d: await r.json().catch(() => ({})) as { error?: string; note?: string } }; };
  async function submitPw(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await post('/api/auth/login', { password: pw });
    setBusy(false);
    if (r.ok) window.location.href = '/'; else setErr(r.d.error || 'Login failed');
  }
  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault(); setBusy(true); setErr(''); setNote('');
    const r = await post('/api/auth/otp', { email });
    setBusy(false);
    if (!r.ok) return setErr(r.d.error || 'Could not send');
    setNote(r.d.note || 'Check your inbox.'); setStep('code'); setCode('');
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await post('/api/auth/otp', { email, code });
    setBusy(false);
    if (r.ok) window.location.href = '/'; else setErr(r.d.error || 'Wrong code');
  }
  return (
    <div className="wrap">
      <div className="panel login">
        <div className="brand" style={{ padding: '0 0 14px' }}><div className="brand-mark">F</div><div><b>FDE Job Finder</b><small>private · request access below</small></div></div>
        <span className="seg" style={{ marginBottom: 12 }}>
          <button className={mode === 'user' ? 'on' : ''} onClick={() => setMode('user')}>Sign in</button>
          <button className={mode === 'request' ? 'on' : ''} onClick={() => { setMode('request'); setErr(''); setNote(''); }}>Request access</button>
          <button className={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>Owner</button>
        </span>
        {mode === 'request' ? (
          <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); const r = await post('/api/auth/request', rq); setBusy(false); if (r.ok) setNote(r.d.note || 'Request sent.'); else setErr(r.d.error || 'Could not send'); }}>
            <p className="muted small">From anywhere in the world, any field. Tell the owner who you are and what job you want — you get an email when access is approved. Then you get your own private space: job search for your role and city, a life/career mentor, AI agents, job alerts to your email, and a route to the hiring manager for every job.</p>
            {(['email', 'name', 'role', 'location'] as const).map((k) => <input key={k} type={k === 'email' ? 'email' : 'text'} required={k === 'email' || k === 'role'} placeholder={{ email: 'Your Gmail / email *', name: 'Your name', role: 'Job you want (any field) *, e.g. data analyst, nurse, ML engineer', location: 'Where (city / country / remote)' }[k]} value={rq[k]} onChange={(e) => setRq({ ...rq, [k]: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />)}
            <textarea placeholder="Your situation in 1–3 lines (optional) — e.g. laid off 3 months ago, switching careers, fresher…" value={rq.situation} onChange={(e) => setRq({ ...rq, situation: e.target.value })} style={{ width: '100%', minHeight: 70, marginBottom: 8 }} />
            <button className="primary" disabled={busy || !rq.email || !rq.role} style={{ width: '100%' }}>{busy ? 'Sending…' : 'Request access'}</button>
          </form>
        ) : mode === 'user' ? (
          <>
            {opts?.google && (
              <>
                <a className="google-btn" href="/api/auth/google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg> Continue with Google</a>
                <div className="or"><span>or get a code by email</span></div>
              </>
            )}
            {step === 'email' ? (
              <form onSubmit={sendCode}>
                <p className="muted small">Enter the Gmail / email the owner gave access to. We email you a 6-digit code — no password.</p>
                <input type="email" autoFocus autoComplete="email" placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
                <button className="primary" disabled={busy || !email} style={{ width: '100%' }}>{busy ? 'Sending…' : 'Email me a code'}</button>
                {opts && !opts.otp && <p className="small muted" style={{ marginTop: 8 }}>Email codes need the owner to finish email setup. Until then use Google sign-in or the invite link the owner sent you.</p>}
              </form>
            ) : (
              <form onSubmit={verify}>
                <p className="muted small">Code sent to <b>{email}</b>.</p>
                <input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ width: '100%', marginBottom: 10, fontSize: 24, letterSpacing: 8, textAlign: 'center' }} />
                <button className="primary" disabled={busy || code.length !== 6} style={{ width: '100%' }}>{busy ? 'Checking…' : 'Sign in'}</button>
                <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}><button type="button" className="small-btn" onClick={() => { setStep('email'); setNote(''); }}>← other email</button><button type="button" className="small-btn" disabled={busy} onClick={() => sendCode()}>Send a new code</button></div>
              </form>
            )}
          </>
        ) : (
          <form onSubmit={submitPw}>
            <p className="muted small">Owner password (can be changed in Settings → Access).</p>
            <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
            <button className="primary" disabled={busy || !pw} style={{ width: '100%' }}>{busy ? 'Checking…' : 'Unlock'}</button>
          </form>
        )}
        {note && <div className="notice ok" style={{ marginTop: 10 }}>{note}</div>}
        {err && <div className="notice err" style={{ marginTop: 10 }}>{err}</div>}
        <p className="small muted" style={{ marginTop: 12 }}>Once signed in you stay signed in on this device (refreshes included) until your access ends or the owner removes you.</p>
      </div>
    </div>
  );
}
