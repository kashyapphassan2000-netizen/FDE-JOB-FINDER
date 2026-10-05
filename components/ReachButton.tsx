'use client';
import { useState } from 'react';
import { api } from './api';

export type ReachItem = { title: string; company?: string; url: string; text?: string; location?: string; author?: string };
type Plan = {
  at: string; decider: { who: string; why: string };
  people: { name: string; role: string; url?: string; email?: string; confidence?: string; why?: string }[];
  inboxes: string[]; route: { step: string; how: string }[]; hacks: string[];
  messages: { channel: string; to: string; text: string }[]; searches: { label: string; url: string }[]; warnings: string[]; model?: string;
};

const planText = (it: ReachItem, p: Plan) => [
  `Decider: ${p.decider.who} — ${p.decider.why}`, '', 'ROUTE', ...p.route.map((r) => `${r.step} — ${r.how}`), '',
  'PEOPLE', ...p.people.map((x) => `- ${x.name} (${x.role})${x.email ? ` · ${x.email}${x.confidence === 'guess' ? ' (guess)' : ''}` : ''}${x.url ? ` · ${x.url}` : ''}`),
  ...(p.inboxes.length ? ['', `Inboxes: ${p.inboxes.join(', ')}`] : []), '', 'HACKS', ...p.hacks.map((h) => `- ${h}`), '',
  'MESSAGES', ...p.messages.flatMap((m) => [`## ${m.channel}${m.to ? ` → ${m.to}` : ''}`, m.text, '']), `Link: ${it.url}`,
].join('\n');

/** 🎯 on every job / post: who decides, the fastest route to them, and the exact words. */
export function ReachButton({ item, toast, small = true }: { item: ReachItem; toast: (s: string) => void; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const go = async (fresh = false) => {
    setOpen(true);
    if (plan && !fresh) return;
    setBusy(true);
    try { setPlan((await api<{ plan: Plan }>('/api/reach', { method: 'POST', body: JSON.stringify({ ...item, fresh }) })).plan); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Copied'));
  return (
    <>
      <button className={small ? 'small-btn' : ''} title="Who decides on this hire, the fastest route to them, and what to say" onClick={() => go()}>🎯 Reach decision-maker</button>
      {open && (
        <div className="drawer-bg" onClick={() => setOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>🎯 Reach the decision-maker</h3><button className="small-btn" onClick={() => setOpen(false)}>✕</button></div>
            <p className="small muted" style={{ margin: '4px 0 10px' }}><b>{item.title}</b>{item.company ? ` — ${item.company}` : ''} · <a href={item.url} target="_blank" rel="noreferrer">open ↗</a></p>
            {busy && <div className="small muted">Finding the real people (web, company site, LinkedIn X-ray) and writing your route… 20–60 s</div>}
            {plan && !busy && (
              <>
                <div className="notice small"><b>Who decides:</b> {plan.decider.who}<br /><span className="muted">{plan.decider.why}</span></div>
                <h4>Fastest route</h4>
                <ol className="small" style={{ paddingLeft: 18 }}>{plan.route.map((r, i) => <li key={i} style={{ marginBottom: 6 }}><b>{r.step.replace(/^\d+\.\s*/, '')}</b> — {r.how}</li>)}</ol>
                {plan.people.length > 0 && <><h4>People (real, from search)</h4>{plan.people.map((p) => <div key={p.name + p.role} className="tline small"><b>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.name} ↗</a> : p.name}</b> — {p.role}{p.email && <> · <code>{p.email}</code> {p.confidence === 'guess' ? <span className="muted">(pattern guess — verify)</span> : <span className="muted">({p.confidence})</span>}</>}{p.why && <div className="muted">{p.why}</div>}</div>)}</>}
                {plan.inboxes.length > 0 && <div className="small" style={{ marginTop: 6 }}>📮 Inboxes: {plan.inboxes.map((e) => <code key={e} style={{ marginRight: 6 }}>{e}</code>)}</div>}
                {plan.hacks.length > 0 && <><h4>Smart hacks / jugaad</h4><ul className="small" style={{ paddingLeft: 18 }}>{plan.hacks.map((h, i) => <li key={i}>{h}</li>)}</ul></>}
                {plan.messages.length > 0 && <><h4>Exact messages</h4>{plan.messages.map((m, i) => <div key={i} className="panel small" style={{ padding: 10, margin: '6px 0' }}><div className="row" style={{ justifyContent: 'space-between' }}><b>{m.channel}{m.to ? ` → ${m.to}` : ''}</b><button className="small-btn" onClick={() => copy(m.text)}>Copy</button></div><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.text}</div></div>)}</>}
                {plan.searches.length > 0 && <><h4>One-click searches</h4><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{plan.searches.map((s) => <a key={s.url} className="small-btn" href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>)}</div></>}
                {plan.warnings.length > 0 && <div className="notice warn small" style={{ marginTop: 8 }}>{plan.warnings.join(' · ')}</div>}
                <div className="row" style={{ gap: 6, marginTop: 12 }}>
                  <button className="small-btn" onClick={() => copy(planText(item, plan))}>Copy all</button>
                  <SaveButton item={{ ...item, text: planText(item, plan) }} folder="Reach plans" toast={toast} label="🔖 Save to Notepad" />
                  <button className="small-btn" onClick={() => go(true)}>⟳ Redo</button>
                  <span className="small muted">{plan.model ? `by ${plan.model}` : ''}</span>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

/** 🔖 Save a post / job to the Notepad "future reference" sheet (one note per link). */
export function SaveButton({ item, toast, folder = 'Saved posts', label = '🔖 Save' }: { item: ReachItem; toast: (s: string) => void; folder?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="small-btn" disabled={done} title="Keep it in Notepad → future reference sheet" onClick={async () => {
      try {
        await api('/api/notes', { method: 'POST', body: JSON.stringify({ action: 'save', note: { title: `${item.title}${item.company ? ` — ${item.company}` : ''}`.slice(0, 120), body: `${item.text || ''}\n\n${item.location ? `Location: ${item.location}\n` : ''}${item.author ? `By: ${item.author}\n` : ''}Link: ${item.url}`.trim(), folder, url: folder === 'Reach plans' ? `${item.url}#reach` : item.url, source: item.author ? 'post' : 'job' } }) });
        setDone(true);
        toast(`Saved to Notepad → ${folder}`);
      } catch (e) { toast((e as Error).message); }
    }}>{done ? '✓ Saved' : label}</button>
  );
}
