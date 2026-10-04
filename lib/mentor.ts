import workbook from '@/data/workbook.json';
import { aiConfigured, chatJson } from './llm';
import { getJSON, setJSON } from './store';
import { getCv } from './cv';
import { newsSearch } from './news';
import { loadVault } from './secrets';
import { ownerEmails } from './access';
import type { MarketReport } from './trends';
import { getIntel } from './intel';
import { getProfile } from './profile';

/**
 * LIFE MENTOR + KNOWLEDGE GRAPH (one private space per person).
 * The mentor = 20+ years in AI / ML / quantum, survived layoffs, office politics and career pivots, married, runs a family budget.
 * It sees: the person's own profile + CV (or none), its memory of past chats, the person's knowledge graph,
 * today's world (AI market report, layoffs, hiring radar, quantum / tech-adoption / money news), the app's job data and the
 * whole Excel workbook (relevant rows retrieved per question). It learns: every chat adds memory facts + graph nodes;
 * a daily brief (cron) says what happened, what may happen, what to learn today, one money move, one career move.
 * Honest: general guidance, not a licensed doctor / financial / legal adviser — it says when to see one.
 */
export type Area = 'me' | 'career' | 'skills' | 'money' | 'health' | 'family' | 'home' | 'learning' | 'network' | 'market' | 'decisions' | 'mindset';
export interface GNode { id: string; label: string; area: Area; notes: string; importance: number; updatedAt: string }
export interface GLink { s: string; t: string; label?: string }
export interface Graph { nodes: GNode[]; links: GLink[] }
export interface MProfile { name: string; about: string; cvText: string; goals: string; updatedAt: string }
export interface Msg { role: 'user' | 'mentor'; text: string; at: string }
export interface Brief { date: string; at: string; headline: string; happened: string[]; mayHappen: string[]; learnToday: { topic: string; why: string; how: string }[]; moneyMove: string; careerMove: string; lifeNote: string; watch: string[] }

export const AREAS: Record<Area, { label: string; color: string }> = {
  me: { label: 'Me', color: '#00f0a0' }, career: { label: 'Career', color: '#60a5fa' }, skills: { label: 'Skills', color: '#a78bfa' },
  money: { label: 'Money', color: '#fbbf24' }, health: { label: 'Health & insurance', color: '#f87171' }, family: { label: 'Family', color: '#f472b6' },
  home: { label: 'Home & car', color: '#fb923c' }, learning: { label: 'Learning', color: '#34d399' }, network: { label: 'Network', color: '#22d3ee' },
  market: { label: 'Market & industry', color: '#94a3b8' }, decisions: { label: 'Decisions', color: '#e879f9' }, mindset: { label: 'Mindset & politics', color: '#facc15' },
};

/** One private namespace per person; the owner (password or owner email) is always "owner". */
export function nsOf(email: string): string {
  const e = email.toLowerCase();
  return e === 'owner' || ownerEmails().includes(e) ? 'owner' : e.replace(/[^a-z0-9@._-]/g, '');
}
const K = (ns: string, k: string) => `mentor:${ns}:${k}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'node';

// ---------- profile ----------
export async function getMProfile(ns: string): Promise<MProfile> {
  const p = await getJSON<MProfile | null>(K(ns, 'profile'), null);
  if (p) return p;
  return { name: '', about: '', cvText: '', goals: '', updatedAt: '' };
}
export async function saveMProfile(ns: string, patch: Partial<MProfile>) {
  const cur = await getMProfile(ns);
  const next: MProfile = { name: String(patch.name ?? cur.name).slice(0, 80), about: String(patch.about ?? cur.about).slice(0, 4000), cvText: String(patch.cvText ?? cur.cvText).slice(0, 15000), goals: String(patch.goals ?? cur.goals).slice(0, 2000), updatedAt: new Date().toISOString() };
  await setJSON(K(ns, 'profile'), next);
  return next;
}
async function cvFor(ns: string, p: MProfile): Promise<string> {
  if (p.cvText.trim()) return p.cvText;
  if (ns === 'owner') { const cv = await getCv(); return cv.text || (cv.skills.length ? `Skills: ${cv.skills.join(', ')}` : ''); }
  return '';
}

// ---------- graph ----------
export async function getGraph(ns: string): Promise<Graph> {
  const g = await getJSON<Graph | null>(K(ns, 'graph'), null);
  if (g?.nodes?.length) return g;
  return seedGraph(ns);
}
async function seedGraph(ns: string): Promise<Graph> {
  const now = new Date().toISOString();
  const p = await getMProfile(ns);
  const nodes: GNode[] = [{ id: 'me', label: p.name || 'Me', area: 'me', notes: p.about || 'Tell your mentor about yourself in the Life mentor page — this graph grows from every chat and every daily brief.', importance: 10, updatedAt: now }];
  const links: GLink[] = [];
  for (const [a, v] of Object.entries(AREAS) as [Area, { label: string }][]) {
    if (a === 'me') continue;
    nodes.push({ id: a, label: v.label, area: a, notes: '', importance: 7, updatedAt: now });
    links.push({ s: 'me', t: a });
  }
  if (ns === 'owner') {
    const [cv, prof] = await Promise.all([getCv(), getProfile()]);
    for (const s of cv.skills.slice(0, 14)) { const id = `skill-${slug(s)}`; nodes.push({ id, label: s, area: 'skills', notes: 'From your CV', importance: 3, updatedAt: now }); links.push({ s: 'skills', t: id }); }
    for (const r of prof.roles.slice(0, 4)) { const id = `goal-${slug(r)}`; nodes.push({ id, label: r, area: 'career', notes: 'A target role from your priorities', importance: 5, updatedAt: now }); links.push({ s: 'career', t: id }); }
  }
  const g = { nodes, links };
  await setJSON(K(ns, 'graph'), g);
  return g;
}
export async function saveGraph(ns: string, g: Graph) {
  const ids = new Set(g.nodes.map((n) => n.id));
  const clean: Graph = { nodes: g.nodes.slice(0, 600), links: g.links.filter((l) => ids.has(l.s) && ids.has(l.t) && l.s !== l.t).slice(0, 1500) };
  await setJSON(K(ns, 'graph'), clean);
  return clean;
}
export interface GraphOps { addNodes?: { label: string; area: Area; notes?: string; linkTo?: string[]; importance?: number }[]; addLinks?: { from: string; to: string; label?: string }[]; notes?: { node: string; append: string }[] }
/** Apply mentor-proposed changes (labels or ids are accepted). */
export async function applyGraphOps(ns: string, ops: GraphOps | null | undefined): Promise<number> {
  if (!ops) return 0;
  const g = await getGraph(ns);
  const now = new Date().toISOString();
  const find = (ref: string) => g.nodes.find((n) => n.id === ref || n.label.toLowerCase() === String(ref || '').toLowerCase()) || g.nodes.find((n) => n.id === String(ref || '').toLowerCase());
  let changes = 0;
  for (const a of ops.addNodes || []) {
    if (!a?.label) continue;
    const area: Area = (a.area in AREAS ? a.area : 'learning') as Area;
    let n = find(a.label);
    if (!n) { n = { id: `${area}-${slug(a.label)}`, label: a.label.slice(0, 60), area, notes: (a.notes || '').slice(0, 2000), importance: Math.max(1, Math.min(9, a.importance || 4)), updatedAt: now }; g.nodes.push(n); changes++; }
    else if (a.notes && !n.notes.includes(a.notes.slice(0, 40))) { n.notes = `${n.notes}\n\n${a.notes}`.trim().slice(0, 6000); n.updatedAt = now; changes++; }
    const targets = a.linkTo?.length ? a.linkTo : [area];
    for (const t of targets) { const tn = find(t); if (tn && !g.links.some((l) => (l.s === n!.id && l.t === tn.id) || (l.s === tn.id && l.t === n!.id))) { g.links.push({ s: tn.id, t: n.id }); changes++; } }
  }
  for (const l of ops.addLinks || []) { const a = find(l.from), b = find(l.to); if (a && b && a.id !== b.id && !g.links.some((x) => (x.s === a.id && x.t === b.id) || (x.s === b.id && x.t === a.id))) { g.links.push({ s: a.id, t: b.id, label: l.label?.slice(0, 40) }); changes++; } }
  for (const u of ops.notes || []) { const n = find(u.node); if (n && u.append) { n.notes = `${n.notes}\n\n${new Date().toISOString().slice(0, 10)}: ${u.append}`.trim().slice(0, 6000); n.updatedAt = now; changes++; } }
  if (changes) await saveGraph(ns, g);
  return changes;
}

// ---------- world context (shared, rebuilt daily) ----------
export interface World { at: string; marketSummary: string; hotSkills: string[]; layoffs: string[]; hiring: string[]; tech: string[]; money: string[]; quantum: string[] }
export async function getWorld(force = false): Promise<World> {
  const cur = await getJSON<World | null>('mentor:world', null);
  if (!force && cur && Date.now() - Date.parse(cur.at) < 20 * 36e5) return cur;
  const [rep, intel] = await Promise.all([getJSON<MarketReport | null>('trends:report', null), getIntel().catch(() => null)]);
  const [tech, money, quantum] = await Promise.all([
    newsSearch(['AI agents enterprise adoption', 'new AI model release developers', 'AI regulation jobs impact'], 7, { perQuery: 6 }).catch(() => ({ items: [] })),
    newsSearch(['India personal finance interest rates', 'RBI repo rate', 'health insurance India premium', 'India IT salary hike'], 14, { perQuery: 5, regions: ['IN'] }).catch(() => ({ items: [] })),
    newsSearch(['quantum computing breakthrough', 'quantum computing jobs India'], 14, { perQuery: 5 }).catch(() => ({ items: [] })),
  ]);
  const line = (n: { title: string; source: string; date: string | null }) => `${(n.date || '').slice(0, 10)} ${n.title} (${n.source})`;
  const w: World = {
    at: new Date().toISOString(),
    marketSummary: rep?.summary || '',
    hotSkills: (rep?.hot_skills || []).slice(0, 10).map((h) => `${h.skill}: ${h.why}`),
    layoffs: (intel?.layoffs || []).slice(0, 10).map((c) => `${c.name}: ${c.layoffs[0]?.count || ''} — ${c.layoffs[0]?.reason || ''} (${c.layoffs[0]?.date || ''})`),
    hiring: (intel?.hiring || []).slice(0, 10).map((c) => `${c.name}: ${c.hiring[0]?.signal || ''}`),
    tech: tech.items.slice(0, 10).map(line), money: money.items.slice(0, 10).map(line), quantum: quantum.items.slice(0, 6).map(line),
  };
  await setJSON('mentor:world', w);
  return w;
}

// ---------- Excel knowledge (retrieval) ----------
type WB = { sheets: { name: string; title: string; header: string[]; rows: { cells: string[]; section: boolean }[] }[] };
function excelContext(question: string, max = 18): string {
  const words = question.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 3 && !['what', 'which', 'should', 'would', 'about', 'there', 'their', 'with', 'from', 'this', 'that', 'have', 'into', 'your', 'when', 'where', 'how'].includes(w));
  if (!words.length) return '';
  const scored: { s: number; t: string }[] = [];
  for (const sh of (workbook as unknown as WB).sheets) for (const r of sh.rows) {
    if (r.section) continue;
    const txt = r.cells.filter(Boolean).join(' | ');
    const low = `${sh.name} ${txt}`.toLowerCase();
    const s = words.reduce((a, w) => a + (low.includes(w) ? 1 : 0), 0);
    if (s) scored.push({ s, t: `[${sh.name}] ${txt.slice(0, 300)}` });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.t).join('\n');
}
const SHEET_NAMES = (workbook as unknown as WB).sheets.map((s) => s.name).join(', ');

// ---------- the mentor ----------
const PERSONA = `You are this person's private life & career MENTOR. Your background: 20+ years in AI, machine learning and quantum computing; you lived through dot-com, 2008, COVID and the AI-era layoffs; you were laid off, promoted, managed teams, handled office politics, switched domains, negotiated offers; you are married, run a family budget, bought a house and car, picked health insurance, invested for the long term.
How you talk: warm but brutally honest, specific, practical, no fluff, no fake facts. Use the person's real situation (profile, CV, memory, graph) and today's real data given to you. Name concrete actions with WHERE to learn and HOW (free resources first). For decisions, lay out options, upside/downside, market timing, risks, a recommendation and a trigger to revisit.
You are NOT a licensed doctor, financial adviser or lawyer: for medical, insurance, tax, investment and legal matters give the general framework, numbers to check and questions to ask, and say clearly when to consult a professional. Never invent the person's experience.`;

export async function mentorChat(ns: string, text: string): Promise<{ reply: string; graphChanges: number; learned: string[] }> {
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in AI & Keys');
  const [p, graph, world, memory, history] = await Promise.all([getMProfile(ns), getGraph(ns), getWorld(), getJSON<{ fact: string; area: string; at: string }[]>(K(ns, 'memory'), []), getJSON<Msg[]>(K(ns, 'chat'), [])]);
  const cv = await cvFor(ns, p);
  const brief = (await getJSON<Brief[]>(K(ns, 'briefs'), []))[0];
  const graphSummary = graph.nodes.filter((n) => n.area !== 'me').sort((a, b) => b.importance - a.importance).slice(0, 60).map((n) => `${AREAS[n.area].label} › ${n.label}${n.notes ? `: ${n.notes.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`).join('\n');
  const xl = excelContext(text);
  const ctx = `PERSON: ${p.name || 'not given'}
ABOUT (their own words): ${p.about || 'not given yet — ask 1-2 key questions when it matters'}
GOALS: ${p.goals || 'not given'}
CV: ${cv ? cv.slice(0, 5000) : 'no CV — work from what they tell you'}
WHAT YOU REMEMBER ABOUT THEM:\n${memory.slice(0, 40).map((m) => `- (${m.area}) ${m.fact}`).join('\n') || '- nothing yet'}
THEIR KNOWLEDGE GRAPH (top nodes):\n${graphSummary || 'empty'}
TODAY'S WORLD (${world.at.slice(0, 10)}):
AI job market: ${world.marketSummary}
Hot skills: ${world.hotSkills.join('; ')}
Layoffs: ${world.layoffs.join('; ')}
Who is hiring: ${world.hiring.join('; ')}
Tech adoption news: ${world.tech.join('; ')}
Quantum: ${world.quantum.join('; ')}
Money/India: ${world.money.join('; ')}
${brief ? `TODAY'S BRIEF YOU GAVE THEM: ${brief.headline}` : ''}
${xl ? `FROM THEIR AI JOB SEARCH EXCEL (sheets: ${SHEET_NAMES}):\n${xl}` : ''}
RECENT CONVERSATION:\n${history.slice(-12).map((m) => `${m.role === 'user' ? 'THEM' : 'YOU'}: ${m.text.slice(0, 600)}`).join('\n')}`;
  const { data } = await chatJson<{ reply: string; learned?: { fact: string; area: Area }[]; graph?: GraphOps }>(
    PERSONA,
    `${ctx}\n\nTHEY SAY NOW: ${text}\n\nReply as their mentor (use short headings / bullets when helpful; be concrete). Also: list any NEW durable facts you learned about them (job, family, money, health, goals, constraints), and propose updates to their knowledge graph (new nodes for skills, goals, decisions, people, money items, risks, learning plans — each linked to an area or existing node).
JSON: {"reply":"markdown","learned":[{"fact":"","area":"career|skills|money|health|family|home|learning|network|market|decisions|mindset"}],"graph":{"addNodes":[{"label":"","area":"","notes":"","linkTo":["existing node label or area"],"importance":1-9}],"addLinks":[{"from":"","to":"","label":""}],"notes":[{"node":"","append":""}]}}`,
    { maxTokens: 5000, timeoutMs: 150000 },
  );
  if (!data?.reply) throw new Error('The mentor could not answer right now (AI quota?) — try again in a minute');
  const now = new Date().toISOString();
  const learned = (data.learned || []).filter((l) => l?.fact).slice(0, 8);
  await Promise.all([
    setJSON(K(ns, 'chat'), [...history, { role: 'user', text, at: now }, { role: 'mentor', text: data.reply, at: now }].slice(-80)),
    learned.length ? setJSON(K(ns, 'memory'), [...learned.map((l) => ({ fact: l.fact.slice(0, 300), area: l.area, at: now })), ...memory].slice(0, 200)) : Promise.resolve(),
  ]);
  const graphChanges = await applyGraphOps(ns, data.graph);
  return { reply: data.reply, graphChanges, learned: learned.map((l) => l.fact) };
}

/** Daily brief: what happened, what may happen, what to learn today, one money move, one career move. */
export async function dailyBrief(ns: string, force = false): Promise<Brief> {
  await loadVault();
  const date = new Date().toISOString().slice(0, 10);
  const list = await getJSON<Brief[]>(K(ns, 'briefs'), []);
  if (!force && list[0]?.date === date) return list[0];
  const [p, world, memory, graph] = await Promise.all([getMProfile(ns), getWorld(), getJSON<{ fact: string; area: string }[]>(K(ns, 'memory'), []), getGraph(ns)]);
  const cv = await cvFor(ns, p);
  const { data } = await chatJson<Brief & { graph?: GraphOps }>(
    PERSONA,
    `Write today's (${date}) private brief for this person. Use ONLY the real data below; predictions must say why.
PERSON: ${p.name || ''} — ${p.about || 'no profile yet'} · goals: ${p.goals || 'n/a'}
CV: ${cv ? cv.slice(0, 3000) : 'none'}
MEMORY: ${memory.slice(0, 25).map((m) => m.fact).join('; ') || 'none'}
SKILLS IN GRAPH: ${graph.nodes.filter((n) => n.area === 'skills').map((n) => n.label).join(', ') || 'none'}
WORLD: market: ${world.marketSummary} | hot skills: ${world.hotSkills.join('; ')} | layoffs: ${world.layoffs.join('; ')} | hiring: ${world.hiring.join('; ')} | tech: ${world.tech.join('; ')} | quantum: ${world.quantum.join('; ')} | money/India: ${world.money.join('; ')}
JSON: {"headline":"one line","happened":["3-5 things that happened that matter to THIS person"],"mayHappen":["2-4 things likely to happen next + why + what it means for them"],"learnToday":[{"topic":"","why":"","how":"where & how, free resource, 30-90 min"}],"moneyMove":"one concrete money action","careerMove":"one concrete career action for today","lifeNote":"one line on mindset / politics / family / health","watch":["companies or trends to watch"],"graph":{"addNodes":[{"label":"","area":"","notes":"","linkTo":[""]}]}}`,
    { maxTokens: 3000, timeoutMs: 120000 },
  );
  if (!data?.headline) throw new Error('Could not write the brief right now (AI quota?)');
  const b: Brief = { date, at: new Date().toISOString(), headline: data.headline, happened: data.happened || [], mayHappen: data.mayHappen || [], learnToday: data.learnToday || [], moneyMove: data.moneyMove || '', careerMove: data.careerMove || '', lifeNote: data.lifeNote || '', watch: data.watch || [] };
  await setJSON(K(ns, 'briefs'), [b, ...list.filter((x) => x.date !== date)].slice(0, 60));
  await applyGraphOps(ns, data.graph);
  return b;
}

export async function mentorState(ns: string) {
  const [profile, graph, chat, memory, briefs, world] = await Promise.all([getMProfile(ns), getGraph(ns), getJSON<Msg[]>(K(ns, 'chat'), []), getJSON<{ fact: string; area: string; at: string }[]>(K(ns, 'memory'), []), getJSON<Brief[]>(K(ns, 'briefs'), []), getJSON<World | null>('mentor:world', null)]);
  return { profile, graph, chat: chat.slice(-40), memory, briefs: briefs.slice(0, 14), worldAt: world?.at || null, hasOwnerCv: ns === 'owner' ? Boolean((await getCv()).text) : false };
}
export async function forget(ns: string, what: 'chat' | 'memory' | 'graph' | 'all') {
  if (what === 'chat' || what === 'all') await setJSON(K(ns, 'chat'), []);
  if (what === 'memory' || what === 'all') await setJSON(K(ns, 'memory'), []);
  if (what === 'graph' || what === 'all') await setJSON(K(ns, 'graph'), null);
}
/** Everyone who has used the mentor (for the daily cron). */
export async function activeSpaces(): Promise<string[]> { return getJSON<string[]>('mentor:spaces', []); }
export async function touchSpace(ns: string) { const s = await activeSpaces(); if (!s.includes(ns)) await setJSON('mentor:spaces', [...s, ns].slice(0, 200)); }
