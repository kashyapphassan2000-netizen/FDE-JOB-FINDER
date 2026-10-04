'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type Note = { id: string; title: string; body: string; pinned: boolean; updatedAt: string; createdAt: string };

export default function NotepadTab({ toast, onUse }: { toast: (s: string) => void; onUse: (text: string, where: 'mentor' | 'analyze' | 'agent') => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id?: string; title: string; body: string; pinned: boolean }>({ title: '', body: '', pinned: false });
  const [q, setQ] = useState('');
  const [state, setState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(() => api<{ notes: Note[] }>('/api/notes').then((d) => { setNotes(d.notes); return d.notes; }).catch((e) => { toast(e.message); return [] as Note[]; }), [toast]);
  useEffect(() => { load().then((ns) => { if (ns[0]) { setSel(ns[0].id); setDraft(ns[0]); } }); }, [load]);
  const save = useCallback(async (d: typeof draft) => {
    if (!d.body.trim() && !d.title.trim()) return;
    setState('saving');
    try { const r = await api<{ note: Note }>('/api/notes', { method: 'POST', body: JSON.stringify({ action: 'save', note: d }) }); setDraft((x) => ({ ...x, id: r.note.id })); setSel(r.note.id); setState('saved'); load(); }
    catch (e) { setState('dirty'); toast((e as Error).message); }
  }, [load, toast]);
  // autosave 1 s after you stop typing
  const edit = (patch: Partial<typeof draft>) => { setDraft((d) => { const n = { ...d, ...patch }; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => save(n), 1000); return n; }); setState('dirty'); };
  const shown = useMemo(() => notes.filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase())), [notes, q]);
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0;
  return (
    <div className="np-layout">
      <aside className="np-list">
        <button className="st-plus" onClick={() => { if (timer.current) clearTimeout(timer.current); setSel(null); setDraft({ title: '', body: '', pinned: false }); setState('saved'); }}>＋ <span>New note</span></button>
        <input placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', margin: '6px 0' }} />
        {shown.map((n) => (
          <button key={n.id} className={`np-item ${sel === n.id ? 'on' : ''}`} onClick={() => { setSel(n.id); setDraft(n); setState('saved'); }}>
            <b>{n.pinned ? '📌 ' : ''}{n.title}</b><small>{ago(n.updatedAt)} ago · {n.body.slice(0, 60).replace(/\n/g, ' ')}</small>
          </button>
        ))}
        {!notes.length && <div className="small muted" style={{ padding: 8 }}>Paste anything here — job descriptions, recruiter messages, interview notes, prompts, links. Private to you, saved automatically.</div>}
      </aside>
      <section className="panel np-editor">
        <div className="row">
          <input className="grow big" placeholder="Title (optional)" value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
          <label className="small"><input type="checkbox" checked={draft.pinned} onChange={(e) => edit({ pinned: e.target.checked })} /> 📌 Pin</label>
        </div>
        <textarea className="np-area" autoFocus placeholder="Paste or type here… (saves automatically)" value={draft.body} onChange={(e) => edit({ body: e.target.value })} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved…' : draft.id ? '✓ Saved' : ''} · {words} words · {draft.body.length} chars</span>
          <span className="row" style={{ gap: 6 }}>
            <button className="small-btn" disabled={!draft.body} onClick={() => navigator.clipboard.writeText(draft.body).then(() => toast('Copied'))}>Copy</button>
            <button className="small-btn" disabled={!draft.body} onClick={() => onUse(draft.body, 'mentor')}>🧭 Ask mentor</button>
            <button className="small-btn" disabled={!draft.body} onClick={() => onUse(draft.body, 'analyze')}>🔬 Analyze job</button>
            <button className="small-btn" disabled={!draft.body} onClick={() => onUse(draft.body, 'agent')}>🤖 Use in agent</button>
            <button className="small-btn" disabled={!draft.body} onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([draft.body], { type: 'text/markdown' })); a.download = `${(draft.title || 'note').replace(/[^\w-]+/g, '_')}.md`; a.click(); }}>⬇ .md</button>
            <ExportButton title={draft.title || 'Note'} sections={[{ title: draft.title || 'Note', text: draft.body }]} />
            {draft.id && <button className="small-btn danger" onClick={async () => { if (!confirm('Delete this note?')) return; await api('/api/notes', { method: 'POST', body: JSON.stringify({ action: 'delete', id: draft.id }) }); setSel(null); setDraft({ title: '', body: '', pinned: false }); load(); }}>Delete</button>}
          </span>
        </div>
      </section>
    </div>
  );
}
