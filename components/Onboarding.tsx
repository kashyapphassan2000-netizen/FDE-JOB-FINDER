'use client';
import { useEffect, useState } from 'react';
import { api } from './api';

/** First visit for a new user (any field, anywhere): map your role + place once; the mentor takes your situation from there. */
export default function Onboarding({ toast, onMentor, onSearch }: { toast: (s: string) => void; onMentor: (q: string) => void; onSearch: (q: string) => void }) {
  const [show, setShow] = useState(false);
  const [roles, setRoles] = useState('');
  const [places, setPlaces] = useState('');
  const [situation, setSituation] = useState('');
  useEffect(() => {
    try { if (localStorage.getItem('fj_onboarded')) return; } catch {}
    api<{ isSet: boolean }>('/api/profile').then((d) => setShow(!d.isSet)).catch(() => null);
  }, []);
  if (!show) return null;
  const done = () => { try { localStorage.setItem('fj_onboarded', '1'); } catch {} setShow(false); };
  async function go() {
    const r = roles.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    if (!r.length) return toast('Type at least one role');
    try {
      await api('/api/profile', { method: 'POST', body: JSON.stringify({ roles: r, locations: places.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) }) });
      done();
      if (situation.trim()) onMentor(`My target: ${r.join(', ')} in ${places || 'any location'}. My situation: ${situation.trim()}. Give me an honest plan to get hired fast — what to fix first, where to apply this week, and how to reach the hiring managers.`);
      else onSearch(`${r[0]}${places ? ` in ${places.split(',')[0]}` : ''}`);
    } catch (e) { toast((e as Error).message); }
  }
  return (
    <div className="panel" style={{ borderColor: 'var(--mint)', marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>👋 Welcome — set this up for YOUR job hunt (1 minute)</h3><button className="small-btn" onClick={done}>Skip</button></div>
      <p className="small muted">Any field, any country. Everything here (search, jobs sorting, alerts, agents, mentor) then works for your role and your place — your data stays private to you.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="grow" placeholder="Roles you want, comma separated — e.g. Data analyst, Business analyst" value={roles} onChange={(e) => setRoles(e.target.value)} />
        <input className="grow" placeholder="Where — e.g. Berlin, Remote, Dubai" value={places} onChange={(e) => setPlaces(e.target.value)} />
      </div>
      <textarea style={{ width: '100%', marginTop: 8, minHeight: 60 }} placeholder="Your situation, honestly (optional) — e.g. laid off 4 months ago, 6 years in support, want to move into data; savings for 3 months…" value={situation} onChange={(e) => setSituation(e.target.value)} />
      <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="primary" onClick={go}>{situation.trim() ? 'Save + get my plan from the mentor' : 'Save + find jobs now'}</button><span className="small muted">Next: upload your CV (Track → CV) and add a job alert to your email (Get the job → My job alerts).</span></div>
    </div>
  );
}
