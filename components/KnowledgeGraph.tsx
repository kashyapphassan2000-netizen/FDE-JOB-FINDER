'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

type Area = 'me' | 'career' | 'skills' | 'money' | 'health' | 'family' | 'home' | 'learning' | 'network' | 'market' | 'decisions' | 'mindset';
type GNode = { id: string; label: string; area: Area; notes: string; importance: number; updatedAt: string };
type GLink = { s: string; t: string; label?: string };
type Graph = { nodes: GNode[]; links: GLink[] };
const AREAS: Record<Area, { label: string; color: string }> = {
  me: { label: 'Me', color: '#00f0a0' }, career: { label: 'Career', color: '#60a5fa' }, skills: { label: 'Skills', color: '#a78bfa' },
  money: { label: 'Money', color: '#fbbf24' }, health: { label: 'Health & insurance', color: '#f87171' }, family: { label: 'Family', color: '#f472b6' },
  home: { label: 'Home & car', color: '#fb923c' }, learning: { label: 'Learning', color: '#34d399' }, network: { label: 'Network', color: '#22d3ee' },
  market: { label: 'Market & industry', color: '#94a3b8' }, decisions: { label: 'Decisions', color: '#e879f9' }, mindset: { label: 'Mindset & politics', color: '#facc15' },
};
type P = { x: number; y: number; vx: number; vy: number; fixed?: boolean };

export default function KnowledgeGraph({ toast, onAsk }: { toast: (s: string) => void; onAsk?: (q: string) => void }) {
  const [g, setG] = useState<Graph | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hide, setHide] = useState<Set<Area>>(new Set());
  const [q, setQ] = useState('');
  const [notes, setNotes] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newArea, setNewArea] = useState<Area>('learning');
  const [linkTo, setLinkTo] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const pos = useRef<Map<string, P>>(new Map());
  const view = useRef({ x: 0, y: 0, k: 1 });
  const alpha = useRef(1);
  const drag = useRef<{ id?: string; px: number; py: number; moved: boolean } | null>(null);
  const raf = useRef(0);

  const load = useCallback(() => api<{ graph: Graph }>('/api/mentor').then((d) => setG(d.graph)).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (!g) return { nodes: [] as GNode[], links: [] as GLink[] };
    const nodes = g.nodes.filter((n) => !hide.has(n.area));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, links: g.links.filter((l) => ids.has(l.s) && ids.has(l.t)) };
  }, [g, hide]);
  const degree = useMemo(() => { const d = new Map<string, number>(); for (const l of visible.links) { d.set(l.s, (d.get(l.s) || 0) + 1); d.set(l.t, (d.get(l.t) || 0) + 1); } return d; }, [visible]);
  const radius = (n: GNode) => (n.area === 'me' ? 18 : 5 + Math.min(10, n.importance * 0.9 + (degree.get(n.id) || 0) * 0.6));

  // init positions for new nodes (near a neighbour), keep existing
  useEffect(() => {
    if (!g) return;
    const m = pos.current;
    for (const n of g.nodes) {
      if (m.has(n.id)) continue;
      const nb = g.links.find((l) => l.t === n.id || l.s === n.id);
      const o = nb ? m.get(nb.s === n.id ? nb.t : nb.s) : undefined;
      const a = Math.random() * Math.PI * 2;
      m.set(n.id, n.area === 'me' ? { x: 0, y: 0, vx: 0, vy: 0 } : { x: (o?.x || 0) + Math.cos(a) * 60, y: (o?.y || 0) + Math.sin(a) * 60, vx: 0, vy: 0 });
    }
    alpha.current = 1;
  }, [g]);

  // simulation + drawing
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const tick = () => {
      const { nodes, links } = visible;
      const m = pos.current;
      if (alpha.current > 0.01) {
        const a = alpha.current;
        for (let i = 0; i < nodes.length; i++) {
          const p = m.get(nodes[i].id)!;
          for (let j = i + 1; j < nodes.length; j++) {
            const q2 = m.get(nodes[j].id)!;
            let dx = p.x - q2.x, dy = p.y - q2.y; let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random(); dy = Math.random(); d2 = 1; }
            if (d2 > 160000) continue;
            const f = (900 / d2) * a;
            p.vx += dx * f; p.vy += dy * f; q2.vx -= dx * f; q2.vy -= dy * f;
          }
        }
        for (const l of links) {
          const s = m.get(l.s)!, t = m.get(l.t)!;
          const dx = t.x - s.x, dy = t.y - s.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const want = l.s === 'me' || l.t === 'me' ? 130 : 70;
          const f = ((d - want) / d) * 0.06 * a;
          s.vx += dx * f; s.vy += dy * f; t.vx -= dx * f; t.vy -= dy * f;
        }
        for (const n of nodes) {
          const p = m.get(n.id)!;
          if (n.area === 'me' && !p.fixed) { p.x *= 0.9; p.y *= 0.9; }
          p.vx -= p.x * 0.002 * a; p.vy -= p.y * 0.002 * a;
          if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
          p.vx *= 0.6; p.vy *= 0.6; p.x += p.vx; p.y += p.vy;
        }
        alpha.current *= 0.985;
      }
      // draw
      const W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const v = view.current;
      ctx.translate(W / 2 + v.x, H / 2 + v.y); ctx.scale(v.k, v.k);
      const needle = q.trim().toLowerCase();
      const nbr = new Set<string>(); if (sel) for (const l of links) { if (l.s === sel) nbr.add(l.t); if (l.t === sel) nbr.add(l.s); }
      for (const l of links) {
        const s = m.get(l.s)!, t = m.get(l.t)!;
        const on = sel && (l.s === sel || l.t === sel);
        ctx.strokeStyle = on ? 'rgba(0,240,160,.85)' : dark ? 'rgba(148,163,184,.22)' : 'rgba(100,116,139,.25)';
        ctx.lineWidth = on ? 1.8 / v.k + 0.6 : 1 / v.k + 0.3;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }
      for (const n of nodes) {
        const p = m.get(n.id)!;
        const r = radius(n);
        const dim = (sel && n.id !== sel && !nbr.has(n.id)) || (needle && !n.label.toLowerCase().includes(needle));
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.fillStyle = AREAS[n.area].color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        if (n.id === sel) { ctx.strokeStyle = dark ? '#fff' : '#0d1424'; ctx.lineWidth = 2.5 / v.k; ctx.stroke(); }
        const showLabel = n.importance >= 6 || n.id === sel || nbr.has(n.id) || v.k > 1.15 || (needle && n.label.toLowerCase().includes(needle));
        if (showLabel) {
          ctx.font = `${n.importance >= 7 || n.area === 'me' ? 600 : 500} ${Math.max(10, 12 / Math.sqrt(v.k))}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = dark ? '#e5e7eb' : '#0f172a';
          ctx.textAlign = 'center';
          ctx.fillText(n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label, p.x, p.y + r + 13 / Math.sqrt(v.k));
        }
        ctx.globalAlpha = 1;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [visible, sel, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (ex: number, ey: number) => { const c = canvas.current!, r = c.getBoundingClientRect(), v = view.current; return { x: (ex - r.left - c.clientWidth / 2 - v.x) / v.k, y: (ey - r.top - c.clientHeight / 2 - v.y) / v.k }; };
  const hit = (ex: number, ey: number) => { const w = toWorld(ex, ey); let best: string | undefined; let bd = Infinity; for (const n of visible.nodes) { const p = pos.current.get(n.id)!; const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < radius(n) + 6 && d < bd) { bd = d; best = n.id; } } return best; };
  const onDown = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); const id = hit(e.clientX, e.clientY); drag.current = { id, px: e.clientX, py: e.clientY, moved: false }; if (id) pos.current.get(id)!.fixed = true; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.id) { const w = toWorld(e.clientX, e.clientY); const p = pos.current.get(d.id)!; p.x = w.x; p.y = w.y; alpha.current = Math.max(alpha.current, 0.3); }
    else { view.current.x += dx; view.current.y += dy; }
    d.px = e.clientX; d.py = e.clientY;
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (!d) return; if (d.id) { pos.current.get(d.id)!.fixed = false; if (!d.moved) select(d.id); } else if (!d.moved) setSel(null); };
  const onWheel = (e: React.WheelEvent) => { const v = view.current; const k = Math.max(0.3, Math.min(3, v.k * (e.deltaY < 0 ? 1.12 : 0.89))); v.k = k; };

  function select(id: string) { setSel(id); const n = g?.nodes.find((x) => x.id === id); setNotes(n?.notes || ''); setLinkTo(''); }
  const node = g?.nodes.find((n) => n.id === sel) || null;
  const neighbours = useMemo(() => (g && sel ? g.links.filter((l) => l.s === sel || l.t === sel).map((l) => g.nodes.find((n) => n.id === (l.s === sel ? l.t : l.s))!).filter(Boolean) : []), [g, sel]);

  async function persist(next: Graph, msg?: string) { setG(next); try { await api('/api/mentor', { method: 'POST', body: JSON.stringify({ action: 'graph-save', graph: next }) }); if (msg) toast(msg); } catch (e) { toast((e as Error).message); } }
  const saveNotes = () => g && node && persist({ ...g, nodes: g.nodes.map((n) => (n.id === node.id ? { ...n, notes, updatedAt: new Date().toISOString() } : n)) }, 'Saved');
  async function addNode() {
    if (!g || !newLabel.trim()) return;
    const r = await api<{ graph: Graph }>('/api/mentor', { method: 'POST', body: JSON.stringify({ action: 'graph-ops', ops: { addNodes: [{ label: newLabel.trim(), area: newArea, linkTo: [node?.id || newArea], importance: 5 }] } }) });
    setG(r.graph); setNewLabel(''); toast('Added');
  }
  const addLink = () => { if (!g || !node || !linkTo || linkTo === node.id) return; persist({ ...g, links: [...g.links, { s: node.id, t: linkTo }] }, 'Linked'); setLinkTo(''); };
  const unlink = (id: string) => g && node && persist({ ...g, links: g.links.filter((l) => !((l.s === node.id && l.t === id) || (l.t === node.id && l.s === id))) });
  const delNode = () => { if (!g || !node || node.id === 'me' || !confirm(`Delete “${node.label}”?`)) return; persist({ nodes: g.nodes.filter((n) => n.id !== node.id), links: g.links.filter((l) => l.s !== node.id && l.t !== node.id) }, 'Deleted'); setSel(null); };

  if (!g) return <div className="panel muted">Loading your knowledge graph…</div>;
  const counts = g.nodes.reduce<Record<string, number>>((a, n) => ((a[n.area] = (a[n.area] || 0) + 1), a), {});
  return (
    <div className="kg-wrap">
      <div className="kg-toolbar">
        <input placeholder="🔍 Find a node…" value={q} onChange={(e) => setQ(e.target.value)} />
        {(Object.keys(AREAS) as Area[]).filter((a) => counts[a]).map((a) => (
          <span key={a} className={`kg-chip ${hide.has(a) ? 'off' : ''}`} onClick={() => setHide((h) => { const n = new Set(h); if (n.has(a)) n.delete(a); else n.add(a); return n; })}>
            <i style={{ background: AREAS[a].color }} />{AREAS[a].label} · {counts[a]}
          </span>
        ))}
        <span className="grow" />
        <button className="small-btn" onClick={() => { view.current = { x: 0, y: 0, k: 1 }; alpha.current = 1; }}>⟲ Re-center</button>
      </div>
      <div className="kg-body">
        <canvas ref={canvas} className="kg-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} />
        <aside className="kg-side">
          {node ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="kg-area" style={{ background: AREAS[node.area].color }}>{AREAS[node.area].label}</span><button className="link" onClick={() => setSel(null)}>✕</button></div>
              <h3 style={{ margin: '8px 0' }}>{node.label}</h3>
              <textarea className="kg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes, plans, numbers, links…" />
              <div className="row"><button className="small-btn primary" onClick={saveNotes}>Save notes</button>{onAsk && <button className="small-btn" onClick={() => onAsk(`Let's go deep on “${node.label}” (${AREAS[node.area].label}). What should I do next? ${node.notes ? `My notes: ${node.notes.slice(0, 400)}` : ''}`)}>🧭 Ask mentor about this</button>}{node.id !== 'me' && <button className="small-btn danger" onClick={delNode}>Delete</button>}</div>
              <h4>Linked ({neighbours.length})</h4>
              <div className="kg-links">{neighbours.map((n) => <span key={n.id} className="kg-link" onClick={() => select(n.id)}><i style={{ background: AREAS[n.area].color }} />{n.label}<b onClick={(e) => { e.stopPropagation(); unlink(n.id); }}>×</b></span>)}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} style={{ flex: 1, minWidth: 0 }}><option value="">Link to…</option>{g.nodes.filter((n) => n.id !== node.id).sort((a, b) => a.label.localeCompare(b.label)).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
                <button className="small-btn" disabled={!linkTo} onClick={addLink}>Link</button>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>updated {new Date(node.updatedAt).toLocaleDateString('en-IN')}</div>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>Your knowledge graph</h3>
              <p className="small muted">{g.nodes.length} notes · {g.links.length} links. Private to you. It grows from every mentor chat and daily brief — and you can add and connect anything: a skill, a goal, a loan, an insurance policy, a person, a decision.</p>
              <p className="small muted">Drag to move · scroll to zoom · click a node to open it.</p>
            </>
          )}
          <h4>Add a note{node ? ` linked to “${node.label}”` : ''}</h4>
          <input style={{ width: '100%', marginBottom: 6 }} placeholder="e.g. Learn LangGraph, Term insurance ₹1 Cr, Ask Ravi for referral" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNode()} />
          <div className="row"><select value={newArea} onChange={(e) => setNewArea(e.target.value as Area)} style={{ flex: 1, minWidth: 0 }}>{(Object.keys(AREAS) as Area[]).filter((a) => a !== 'me').map((a) => <option key={a} value={a}>{AREAS[a].label}</option>)}</select><button className="small-btn primary" disabled={!newLabel.trim()} onClick={addNode}>＋ Add</button></div>
        </aside>
      </div>
    </div>
  );
}
