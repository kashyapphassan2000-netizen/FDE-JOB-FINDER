'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton, { type Section } from './ExportButton';
import type { Analysis } from '@/lib/analyzer';

type Item = { id: string; at: string; title: string; company: string; score: number };

export default function AnalyzerTab({ toast, onReferrals, seed }: { toast: (s: string) => void; onReferrals?: (company: string, role: string) => void; seed?: { url: string; company: string; n: number } | null }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [company, setCompany] = useState('');
  useEffect(() => { if (seed) { setUrl(seed.url); setCompany(seed.company); window.scrollTo({ top: 0 }); } }, [seed]);
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [list, setList] = useState<Item[]>([]);
  const [a, setA] = useState<Analysis | null>(null);
  const [round, setRound] = useState(0);
  const load = useCallback(() => api<{ list: Item[] }>('/api/analyze').then((d) => setList(d.list)).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!busy) return; setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [busy]);

  async function run() {
    setBusy(true);
    try {
      const d = await api<{ analysis: Analysis }>('/api/analyze', { method: 'POST', body: JSON.stringify({ url: url.trim() || undefined, text: text.trim() || undefined, company: company.trim() || undefined }) });
      setA(d.analysis); setRound(0); load();
      toast(`Done — ${d.analysis.questions.reduce((n, r) => n + r.items.length, 0)} questions, ${d.analysis.sources.length} sources`);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  async function open(id: string) { const d = await api<{ analysis: Analysis }>(`/api/analyze?id=${id}`); setA(d.analysis); setRound(0); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  async function del(id: string) { await api('/api/analyze', { method: 'DELETE', body: JSON.stringify({ id }) }); if (a?.id === id) setA(null); load(); }

  const qSections = (x: Analysis): Section[] => x.questions.map((r) => ({ title: `${r.round} (${r.items.length} questions)`, headers: ['#', 'Question', 'Type', 'Source', 'What they test', 'Strong answer covers'], rows: r.items.map((q, i) => [String(i + 1), q.q, q.type, q.source === 'reported' ? `REPORTED${q.ref ? ` [S${q.ref}]` : ''}` : 'likely', q.why, q.answer]) }));
  const fullSections = (x: Analysis): Section[] => [
    { title: 'The role', text: `${x.job.summary}\nLocation: ${x.job.location} · ${x.job.seniority} · ${x.job.type} · Salary: ${x.job.salary}\nMust have: ${x.job.mustHave.join('; ')}\nNice to have: ${x.job.niceToHave.join('; ')}\nStack: ${x.job.stack.join(', ')}${x.job.redFlags.length ? `\nRed flags: ${x.job.redFlags.join('; ')}` : ''}` },
    { title: 'Company — good', text: x.company.good.map((g) => `+ ${g}`).join('\n') }, { title: 'Company — bad / risks', text: x.company.bad.map((g) => `- ${g}`).join('\n') },
    { title: 'Company read', text: `${x.company.about}\nCulture: ${x.company.culture}\nStability: ${x.company.stability}\nPay: ${x.company.payInsight}\nVerdict: ${x.company.verdict}` },
    { title: 'Interview process', headers: ['Round', 'Format', 'Focus', 'Duration', 'Tips'], rows: x.process.rounds.map((r) => [r.name, r.format, r.focus, r.duration, r.tips.join(' · ')]) },
    { title: 'Strategy & mindset', text: `Positioning: ${x.strategy.positioning}\n\nMindset:\n${x.strategy.mindset.map((m) => `• ${m}`).join('\n')}\n\nStories to prepare:\n${x.strategy.storyBank.map((m) => `• ${m}`).join('\n')}\n\nDo NOT:\n${x.strategy.doNot.map((m) => `• ${m}`).join('\n')}` },
    ...qSections(x), { title: 'Questions to ask them', text: x.askThem.map((q) => `• ${q}`).join('\n') },
    { title: 'Referrals — who to approach', headers: ['Who', 'Why', 'How to find them'], rows: x.referrals.targets.map((t) => [t.who, t.why, t.search]) },
    { title: 'Referral messages', text: x.referrals.messages.map((m) => `${m.kind}:\n${m.text}`).join('\n\n') }, { title: 'Referral hacks', text: x.referrals.hacks.map((h) => `• ${h}`).join('\n') },
    { title: x.fit.score < 0 ? 'Your fit (upload CV for a score)' : `Your fit: ${x.fit.score}/100`, text: `Strengths:\n${x.fit.strengths.map((s) => `+ ${s}`).join('\n')}\n\nGaps:\n${x.fit.gaps.map((s) => `- ${s}`).join('\n')}\n\nResume tweaks:\n${x.fit.resumeTweaks.map((s) => `• ${s}`).join('\n')}` },
    { title: 'Projects to build', headers: ['Project', 'What', 'Stack', 'Proves', 'Time'], rows: x.fit.projects.map((p) => [p.name, p.what, p.stack, p.why, p.days]) },
    { title: 'Skills to add', headers: ['Skill', 'Why', 'Free resource'], rows: x.fit.skills.map((s) => [s.skill, s.why, s.resource]) },
    { title: '7-day plan', headers: ['Day', 'Tasks'], rows: x.fit.plan.map((p) => [p.day, p.tasks]) },
    { title: 'Sources', headers: ['#', 'Type', 'Title', 'Link'], rows: x.sources.map((s) => [`S${s.n}`, s.kind, s.title, s.url]) },
  ];
  const L = (xs: string[], cls = '') => <ul className={`ana-list ${cls}`}>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;

  return (
    <>
      <div className="hero">
        <div>
          <h2>Job analyzer & interview prep</h2>
          <p>Paste any job — LinkedIn, X, a company careers page or the description text. The app reads it, researches real interview reports (Glassdoor, AmbitionBox, LeetCode Discuss, Reddit, Blind), company news and reviews, then gives you the company’s good & bad, the interview rounds, round-by-round questions with model answers, referral routes, projects and skills to add, and a 7-day plan — mapped to your CV. Download the questions as a PDF.</p>
        </div>
      </div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="grow big" placeholder="Job link — LinkedIn / X / careers page (optional if you paste the text)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <textarea className="tabprompt" rows={5} placeholder="Paste the job description here (recommended for LinkedIn — it often blocks readers)…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy || (!url.trim() && !text.trim())} onClick={run}>{busy ? `Researching… ${secs}s (1–3 min)` : '🔬 Analyze & prepare me'}</button>
          <span className="small muted">Uses ~8 web searches + 4 AI passes. “Reported” questions come from real interview write-ups; “likely” ones are predicted from the job post — nobody can promise 100%, this is the closest you can get.</span>
        </div>
      </div>

      {a && (
        <>
          <div className="ana-head panel">
            <div>
              <div className="small muted">{a.job.company} · {a.job.location} · analysed {ago(a.at)} ago</div>
              <h2 style={{ margin: '2px 0 6px' }}>{a.job.title}</h2>
              <div className="small">{a.job.summary}</div>
            </div>
            <div className="ana-score"><div className="jr-ring" style={{ ['--p' as string]: Math.max(0, a.fit.score) }}><span>{a.fit.score < 0 ? '—' : <>{a.fit.score}<small>%</small></>}</span></div><b>{a.fit.score < 0 ? 'UPLOAD CV FOR FIT' : 'YOUR FIT'}</b></div>
            <div className="row" style={{ gridColumn: '1 / -1' }}>
              <ExportButton title={`Interview questions — ${a.job.title} at ${a.job.company}`} filename={`questions-${a.job.company}`} subtitle={`${a.questions.reduce((n, r) => n + r.items.length, 0)} questions across ${a.questions.length} rounds. REPORTED = seen in real interview reports (source number); likely = predicted from the job post.`} sections={[...qSections(a), { title: 'Questions to ask them', text: a.askThem.map((q) => `• ${q}`).join('\n') }, { title: 'Sources', headers: ['#', 'Title', 'Link'], rows: a.sources.map((s) => [`S${s.n}`, s.title, s.url]) }]} />
              <span className="small muted">questions PDF</span>
              <ExportButton title={`Full prep report — ${a.job.title} at ${a.job.company}`} filename={`prep-${a.job.company}`} subtitle={`Analysed ${new Date(a.at).toLocaleString('en-IN')} · ${a.sources.length} sources`} sections={fullSections(a)} />
              <span className="small muted">full report PDF</span>
              {onReferrals && <button className="small-btn" onClick={() => onReferrals(a.job.company, a.job.title)}>🤝 Find recruiters & referrers at {a.job.company}</button>}
            </div>
          </div>

          <div className="grid2">
            <div className="panel"><h3>✅ Must have</h3>{L(a.job.mustHave)}<h3>➕ Nice to have</h3>{L(a.job.niceToHave)}<div className="small"><b>Stack:</b> {a.job.stack.join(', ')}</div>{a.job.redFlags.length > 0 && <><h3>🚩 Red flags</h3>{L(a.job.redFlags, 'bad')}</>}</div>
            <div className="panel"><h3>🏢 {a.job.company}: the good</h3>{L(a.company.good, 'good')}<h3>⚠️ The bad / risks</h3>{L(a.company.bad, 'bad')}<div className="small"><b>Culture:</b> {a.company.culture}</div><div className="small"><b>Stability:</b> {a.company.stability}</div><div className="small"><b>Pay:</b> {a.company.payInsight}</div><div className="notice ok small" style={{ marginTop: 8 }}><b>Verdict:</b> {a.company.verdict}</div></div>
          </div>
          {a.company.news.length > 0 && <div className="panel"><h3>📰 Latest news</h3>{a.company.news.slice(0, 8).map((n, i) => <div key={i} className="small tline"><span className="badge b-date">{n.date}</span> <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a></div>)}</div>}

          <div className="panel">
            <h3>🧭 Interview process {a.process.difficulty && <span className="badge b-dom">{a.process.difficulty}</span>}</h3>
            <div className="small muted" style={{ marginBottom: 8 }}>{a.process.timeline} · {a.process.source}</div>
            <div className="ana-rounds">{a.process.rounds.map((r, i) => <div key={i} className="card"><b>{i + 1}. {r.name}</b><div className="small muted">{r.format} · {r.duration}</div><div className="small">{r.focus}</div>{L(r.tips)}</div>)}</div>
          </div>

          <div className="panel">
            <h3>🎯 Questions, round by round</h3>
            <div className="jr-tabs" style={{ marginBottom: 10 }}>{a.questions.map((r, i) => <button key={i} className={round === i ? 'on' : ''} onClick={() => setRound(i)}>{r.round} <span>{r.items.length}</span></button>)}</div>
            {a.questions[round]?.items.map((q, i) => (
              <details key={i} className="ana-q">
                <summary><b>{i + 1}.</b> {q.q} <span className={`badge ${q.source === 'reported' ? 'b-ok' : 'b-skip'}`}>{q.source === 'reported' ? `reported${q.ref ? ` · S${q.ref}` : ''}` : 'likely'}</span> <span className="badge b-dom">{q.type}</span></summary>
                <div className="small muted">Tests: {q.why}</div>
                <div className="small" style={{ marginTop: 4 }}><b>Strong answer:</b> {q.answer}</div>
              </details>
            ))}
            {a.askThem.length > 0 && <><h4>Ask them</h4>{L(a.askThem)}</>}
          </div>

          <div className="grid2">
            <div className="panel"><h3>🧠 Strategy & mindset</h3><div className="notice ok small"><b>Your story:</b> {a.strategy.positioning}</div>{L(a.strategy.mindset)}<h4>Stories to prepare</h4>{L(a.strategy.storyBank)}<h4>Do not</h4>{L(a.strategy.doNot, 'bad')}</div>
            <div className="panel"><h3>🤝 Referral route</h3>{a.referrals.targets.map((t, i) => <div key={i} className="tline"><b>{t.who}</b><div className="small">{t.why}</div><div className="small mono muted">{t.search}</div></div>)}<h4>Hacks</h4>{L(a.referrals.hacks)}
              {a.referrals.messages.map((m, i) => <details key={i} className="ana-q"><summary>{m.kind}</summary><pre className="ana-msg">{m.text}</pre><button className="small-btn" onClick={() => { navigator.clipboard?.writeText(m.text); toast('Copied'); }}>Copy</button></details>)}</div>
          </div>

          <div className="grid2">
            <div className="panel"><h3>📊 Your fit — {a.fit.score < 0 ? 'upload your CV (Track → CV) for a real score' : `${a.fit.score}/100`}</h3><h4>Strengths</h4>{L(a.fit.strengths, 'good')}<h4>Gaps</h4>{L(a.fit.gaps, 'bad')}<h4>Resume tweaks</h4>{L(a.fit.resumeTweaks)}</div>
            <div className="panel"><h3>🛠 Projects to build</h3>{a.fit.projects.map((p, i) => <div key={i} className="card"><b>{p.name}</b> <span className="badge b-date">{p.days}</span><div className="small">{p.what}</div><div className="small muted">Stack: {p.stack} · proves: {p.why}</div></div>)}<h3>📚 Skills to add</h3>{a.fit.skills.map((s, i) => <div key={i} className="small tline"><b>{s.skill}</b> — {s.why} <span className="muted">({s.resource})</span></div>)}</div>
          </div>
          <div className="panel"><h3>📅 7-day plan</h3>{a.fit.plan.map((p, i) => <div key={i} className="small tline"><b>{p.day}:</b> {p.tasks}</div>)}</div>
          <details className="panel small"><summary>{a.sources.length} sources</summary><ol>{a.sources.map((s) => <li key={s.n}><span className="muted">[S{s.n}] {s.kind} · </span><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ol></details>
        </>
      )}

      {list.length > 0 && (
        <div className="panel">
          <h3>Your analyses</h3>
          {list.map((x) => <div key={x.id} className="row tline"><a onClick={() => open(x.id)} style={{ cursor: 'pointer' }}><b>{x.title}</b> · {x.company}</a>{x.score >= 0 && <span className="badge b-ok">{x.score}% fit</span>}<span className="small muted">{ago(x.at)} ago</span><span className="grow" /><button className="small-btn danger" onClick={() => del(x.id)}>Delete</button></div>)}
        </div>
      )}
    </>
  );
}
