'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type Msg = { role: 'user' | 'mentor'; text: string; at: string };
type Brief = { date: string; at: string; headline: string; happened: string[]; mayHappen: string[]; learnToday: { topic: string; why: string; how: string }[]; moneyMove: string; careerMove: string; lifeNote: string; watch: string[] };
type Profile = { name: string; about: string; cvText: string; goals: string; updatedAt: string };
type State = { profile: Profile; chat: Msg[]; memory: { fact: string; area: string; at: string }[]; briefs: Brief[]; worldAt: string | null; hasOwnerCv: boolean; you: string; graph: { nodes: unknown[]; links: unknown[] } };

const QUICK = [
  'What should I learn this week to stay ahead in the AI era?', 'Am I at risk from the current layoffs? What should I do?', 'Should I switch jobs now or wait? Analyse the market for me.',
  'Plan my money: salary split, emergency fund, investments, loans.', 'Which health / term insurance should my family have?', 'Should I buy a car now or wait?',
  'My manager / office politics problem — how do I handle it?', 'Should I learn quantum computing? When does it pay off?', 'Map my CV to the best FDE / AI roles and my gaps.',
];

/** Tiny safe markdown: ### headings, - bullets, 1. lists, **bold** — no HTML injection. */
function Md({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list}</ul>); list = []; } };
  lines.forEach((l, i) => {
    const t = l.trim();
    if (/^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) { list.push(<li key={i}>{inline(t.replace(/^([-*•]|\d+[.)])\s+/, ''))}</li>); return; }
    flush();
    if (/^#{1,4}\s/.test(t)) out.push(<h4 key={i}>{inline(t.replace(/^#+\s/, ''))}</h4>);
    else if (t) out.push(<p key={i}>{inline(t)}</p>);
  });
  flush();
  return <div className="md">{out}</div>;
}

export default function MentorTab({ toast, openGraph, seed }: { toast: (s: string) => void; openGraph?: () => void; seed?: { q: string; n: number } | null }) {
  const [s, setS] = useState<State | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [secs, setSecs] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [p, setP] = useState<Profile | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (seed?.q) setText(seed.q); }, [seed]);
  const load = useCallback(() => api<State>('/api/mentor').then((d) => { setS(d); setP(d.profile); if (!d.profile.about && !d.chat.length) setShowProfile(true); }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const box = end.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; }, [s?.chat.length, busy]);
  useEffect(() => { if (!busy) return; setSecs(0); const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t); }, [busy]);

  async function send(q = text) {
    if (!q.trim() || busy) return;
    setBusy('chat'); setText('');
    setS((x) => (x ? { ...x, chat: [...x.chat, { role: 'user', text: q, at: new Date().toISOString() }] } : x));
    try {
      const r = await api<{ reply: string; graphChanges: number; learned: string[] }>('/api/mentor', { method: 'POST', body: JSON.stringify({ action: 'chat', text: q }) });
      if (r.graphChanges || r.learned.length) toast(`Mentor learned ${r.learned.length} thing${r.learned.length === 1 ? '' : 's'} · graph +${r.graphChanges}`);
      await load();
    } catch (e) { toast((e as Error).message); await load(); } finally { setBusy(''); }
  }
  async function brief(force = false) {
    setBusy('brief');
    try { await api('/api/mentor', { method: 'POST', body: JSON.stringify({ action: 'brief', force }) }); await load(); } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function saveProfile() {
    if (!p) return;
    setBusy('profile');
    try { await api('/api/mentor', { method: 'POST', body: JSON.stringify({ action: 'profile', ...p }) }); toast('Saved — your mentor will use this'); setShowProfile(false); await load(); } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }
  async function forget(what: string) { if (!confirm(`Forget your ${what}? This cannot be undone.`)) return; await api('/api/mentor', { method: 'POST', body: JSON.stringify({ action: 'forget', what }) }); load(); }

  if (!s || !p) return <div className="panel muted">Opening your mentor…</div>;
  const b = s.briefs[0];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="hero">
        <div>
          <h2>🧭 Your life & career mentor</h2>
          <p>20+ years in AI, ML and quantum — layoffs, promotions, office politics, family money, insurance, big decisions. Knows your CV{s.hasOwnerCv ? '' : ' (if you add it)'}, remembers what you tell it, reads today’s market, layoffs and hiring news, and your whole AI-job-search Excel. Private to you ({s.you === 'owner' ? 'owner' : s.you}).</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={!!busy} onClick={() => brief(!!b && b.date === today)}>{busy === 'brief' ? `Writing your brief… ${secs}s` : b?.date === today ? '🔄 Refresh today’s brief' : '☀️ Get today’s brief'}</button>
            <button onClick={() => setShowProfile(!showProfile)}>👤 About me & CV</button>
            {openGraph && <button onClick={openGraph}>🕸 My knowledge graph ({s.graph.nodes.length})</button>}
          </div>
        </div>
        <div className="hero-stats"><div><b>{s.memory.length}</b><span>things it knows</span></div><div><b>{s.briefs.length}</b><span>daily briefs</span></div></div>
      </div>

      {showProfile && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>About you — the more honest, the better the guidance</h3>
          <div className="grid2">
            <div>
              <input style={{ width: '100%', marginBottom: 8 }} placeholder="Your name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
              <textarea className="tabprompt" rows={6} placeholder="Age, city, family (married? kids? parents?), current job & salary band, years of experience, savings/loans, health/insurance you have, what worries you, what you enjoy…" value={p.about} onChange={(e) => setP({ ...p, about: e.target.value })} />
              <textarea className="tabprompt" rows={3} placeholder="Goals — e.g. FDE role in 6 months, ₹40 LPA in 2 years, buy a home by 2029, stay layoff-proof" value={p.goals} onChange={(e) => setP({ ...p, goals: e.target.value })} style={{ marginTop: 8 }} />
            </div>
            <div>
              <textarea className="tabprompt" rows={11} placeholder={s.you === 'owner' && s.hasOwnerCv ? 'Your uploaded CV (Track → CV) is already used. Paste a different CV here to override, or leave empty.' : 'Paste your CV text here (optional — the mentor works without it too)'} value={p.cvText} onChange={(e) => setP({ ...p, cvText: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="primary" disabled={busy === 'profile'} onClick={saveProfile}>Save</button><span className="small muted">Stored privately for you only.</span></div>
        </div>
      )}

      <div className="mentor-grid">
        <div className="panel mentor-chat">
          <div className="mentor-msgs">
            {!s.chat.length && <div className="mentor-empty"><b>Ask anything</b> — career moves, what to learn, layoffs, money, insurance, car, family, office politics, a decision you’re stuck on.</div>}
            {s.chat.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>{m.role === 'mentor' ? <Md text={m.text} /> : m.text}<span className="bubble-at">{ago(m.at)} ago</span></div>
            ))}
            {busy === 'chat' && <div className="bubble mentor typing">Thinking it through with today’s data… {secs}s</div>}
            <div ref={end} />
          </div>
          <div className="mentor-quick">{QUICK.map((q) => <span key={q} className="chip" onClick={() => send(q)}>{q}</span>)}</div>
          <div className="mentor-input">
            <textarea rows={2} placeholder="Talk to your mentor… (Enter to send, Shift+Enter for a new line)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="primary" disabled={!!busy || !text.trim()} onClick={() => send()}>Send</button>
          </div>
        </div>

        <div className="mentor-side">
          {b ? (
            <div className="panel brief">
              <div className="small muted">DAILY BRIEF · {b.date}</div>
              <h3 style={{ margin: '4px 0 10px' }}>{b.headline}</h3>
              <h4>📰 What happened</h4><ul>{b.happened.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h4>🔮 What may happen</h4><ul>{b.mayHappen.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <h4>📚 Learn today</h4>{b.learnToday.map((l, i) => <div key={i} className="learn"><b>{l.topic}</b><div className="small">{l.why}</div><div className="small muted">{l.how}</div></div>)}
              <div className="brief-move"><b>💰 Money</b> {b.moneyMove}</div>
              <div className="brief-move"><b>🚀 Career</b> {b.careerMove}</div>
              <div className="brief-move"><b>🧭 Life</b> {b.lifeNote}</div>
              {b.watch.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Watch: {b.watch.join(' · ')}</div>}
              <div className="row" style={{ marginTop: 10 }}>
                <ExportButton title={`Daily brief — ${b.date}`} filename={`brief-${b.date}`} subtitle={b.headline} sections={[{ title: 'What happened', text: b.happened.map((x) => `• ${x}`).join('\n') }, { title: 'What may happen', text: b.mayHappen.map((x) => `• ${x}`).join('\n') }, { title: 'Learn today', headers: ['Topic', 'Why', 'How'], rows: b.learnToday.map((l) => [l.topic, l.why, l.how]) }, { title: 'Moves', text: `Money: ${b.moneyMove}\nCareer: ${b.careerMove}\nLife: ${b.lifeNote}` }]} />
                {s.briefs.length > 1 && <span className="small muted">{s.briefs.length - 1} earlier briefs kept</span>}
              </div>
            </div>
          ) : (
            <div className="panel brief"><h3 style={{ marginTop: 0 }}>☀️ Your daily brief</h3><p className="small muted">Every morning (~7 am IST) your mentor reads the AI market, layoffs, hiring, new tech, quantum and money news and writes what it means for <b>you</b> — what happened, what may happen, what to learn today, one money move, one career move. It is also emailed to you. Click “Get today’s brief” now.</p></div>
          )}
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>🧠 What your mentor knows about you</h3>
            {s.memory.length ? <ul className="small">{s.memory.slice(0, 25).map((m, i) => <li key={i}><span className="badge b-dom">{m.area}</span> {m.fact}</li>)}</ul> : <p className="small muted">Nothing yet — it learns from every chat.</p>}
            <div className="row"><button className="small-btn" onClick={() => forget('chat')}>Clear chat</button><button className="small-btn" onClick={() => forget('memory')}>Forget memory</button><button className="small-btn danger" onClick={() => forget('all')}>Reset everything</button></div>
          </div>
          <div className="small muted" style={{ padding: '0 4px' }}>General guidance from an AI mentor, not a licensed doctor, financial adviser or lawyer — for medical, insurance, tax, investment and legal decisions it tells you what to check and when to see a professional.</div>
        </div>
      </div>
    </>
  );
}
