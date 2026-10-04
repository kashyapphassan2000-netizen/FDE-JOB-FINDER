'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, api, dateLabel, isStale } from './api';
import ExportButton from './ExportButton';

type H = { signal: string; roles: string; region: string; timeframe: string; confidence: 'high' | 'medium' | 'low'; url: string; date: string; kind: string; source?: string };
type L = { date: string; count: string; reason: string; next: string; region: string; url: string; aiRelated: boolean; teams?: string; forYou?: string; source?: string };
type Meta = { at: string; found: number; ai: string; brief?: string; articles?: number; news?: number; days?: number } | null;
type C = { key: string; name: string; hiring: H[]; layoffs: L[]; openRoles?: number; newRoles7d?: number; inYourTracker?: boolean; openInYourFeed?: number };
type Payload = { hiring: C[]; layoffs: C[]; companies: number; hiringScanned: string | null; layoffsScanned: string | null; hiringMeta: Meta; layoffsMeta: Meta; freshDays: { hiring: number; layoffs: number } };

const CONF: Record<string, string> = { high: 'b-ok', medium: 'b-warn', low: 'b-skip' };

export default function IntelTab({ mode, toast, onOutreach }: { mode: 'hiring' | 'layoffs'; toast: (s: string) => void; onOutreach?: (company: string, role: string) => void }) {
  const [d, setD] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('mine');
  const auto = useRef(false);
  const load = useCallback(() => api<Payload>('/api/intel').then((p) => { setD(p); return p; }).catch((e) => { toast(e.message); return null; }), [toast]);

  const scan = useCallback(async (silent = false) => {
    setBusy(true);
    if (!silent) toast(mode === 'hiring' ? 'Reading this week’s hiring / expansion / funding news in full (1–2 min)…' : 'Reading this week’s layoff news in full (1–2 min)…');
    try {
      const r = await api<{ found: number; companies: string[]; articles: number; news: number; purged: number }>('/api/intel', { method: 'POST', body: JSON.stringify({ kind: mode }) });
      toast(`${r.news} fresh news items · ${r.articles} articles read · ${r.found} signals · ${r.purged} old ones removed`);
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [mode, load, toast]);

  // fresh data on open: if the last scan is older than 20 h, rescan automatically
  useEffect(() => {
    auto.current = false;
    load().then((p) => {
      if (!p || auto.current) return;
      auto.current = true;
      if (isStale(mode === 'hiring' ? p.hiringScanned : p.layoffsScanned, 20)) scan(true);
    });
  }, [load, mode, scan]);

  const list = useMemo(() => {
    const src = mode === 'hiring' ? d?.hiring || [] : d?.layoffs || [];
    return src.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (mode === 'hiring' && region === 'mine') return c.hiring.some((h) => /bengaluru|bangalore|india|remote|global|worldwide|your job list/i.test(h.region));
      return true;
    });
  }, [d, mode, q, region]);

  if (!d) return <div className="panel muted">Loading company intel…</div>;
  const scanned = mode === 'hiring' ? d.hiringScanned : d.layoffsScanned;
  const meta = mode === 'hiring' ? d.hiringMeta : d.layoffsMeta;
  const win = d.freshDays?.[mode] || 45;
  const exportRows = list.flatMap((c) => (mode === 'hiring'
    ? c.hiring.map((h) => [c.name, h.date, h.signal, h.roles, h.region, h.timeframe, h.confidence, h.source || h.kind, h.url])
    : c.layoffs.map((l) => [c.name, l.date, l.count, l.reason, l.teams || '', l.next, l.forYou || '', l.region, l.url])));
  return (
    <>
      <div className="hero">
        <div>
          <h2>{mode === 'hiring' ? 'Who will hire FDE & AI/ML next' : 'Who is cutting jobs — and why'}</h2>
          <p>{mode === 'hiring'
            ? 'Forward-looking signals with evidence: funding rounds (Excel: hiring follows in 2–8 weeks), new Bengaluru/India offices and GCCs, announced hiring plans, and companies opening many FDE/AI roles in your own feed right now. Reach them before the JD is posted.'
            : 'Layoffs from recent news with the stated reason and what the company says it does next. Use it two ways: avoid shaky employers, and target companies cutting old teams to rebuild around AI (they hire FDE/AI people).'}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy} onClick={() => scan()}>{busy ? 'Reading fresh news…' : '🔄 Rescan now'}</button>
            <span className="small" style={{ color: '#fff', opacity: 0.9 }}>{busy ? 'getting the latest — results appear when done' : scanned ? `updated ${ago(scanned)} ago · auto-refresh daily + whenever older than 20 h` : 'never scanned'}</span>
            <ExportButton title={mode === 'hiring' ? 'Hiring radar — who will hire FDE & AI/ML' : 'Layoffs — who, why, what next'} subtitle={`${meta?.brief || ''}\nOnly signals from the last ${win} days. Updated ${scanned ? new Date(scanned).toLocaleString('en-IN') : 'never'}.`}
              sections={[{ title: `${list.length} companies`, headers: mode === 'hiring' ? ['Company', 'Date', 'Signal', 'Likely roles', 'Region', 'When', 'Conf.', 'Source', 'Link'] : ['Company', 'Date', 'Cut', 'Why', 'Teams hit', 'Next', 'For you', 'Region', 'Link'], rows: exportRows }]} filename={mode === 'hiring' ? 'hiring-radar' : 'layoffs'} />
          </div>
        </div>
        <div className="hero-stats">
          <div><b>{mode === 'hiring' ? d.hiring.length : d.layoffs.length}</b><span>companies</span></div>
          <div><b>{d.companies}</b><span>in your intel registry</span></div>
        </div>
      </div>
      {meta?.brief && <div className="notice ok"><b>This week{meta.days ? ` (last ${meta.days} days)` : ''}:</b> {meta.brief} <span className="small muted">— {meta.news} fresh news items, {meta.articles} full articles read{meta.ai ? ` · ${meta.ai}` : ''}</span></div>}
      <div className="notice small">
        <b>Fresh only:</b> news from the last 7 days is read in full (Google News + Bing News, free); anything older than {win} days is removed automatically. <b>Honest scope:</b> nobody can list every company in the world. This registry grows from every news scan, funding feed, agent search and job you collect ({d.companies} companies so far). Each signal links to its source — a “forecast” here means the AI read a public announcement, not a guarantee.
      </div>
      <div className="panel row">
        <input className="grow" placeholder="Filter companies…" value={q} onChange={(e) => setQ(e.target.value)} />
        {mode === 'hiring' && (
          <span className="seg"><button className={region === 'mine' ? 'on' : ''} onClick={() => setRegion('mine')}>Bengaluru / India / remote</button><button className={region === 'all' ? 'on' : ''} onClick={() => setRegion('all')}>Everywhere</button></span>
        )}
      </div>
      <div className="finds">
        {list.slice(0, 300).map((c) => (
          <div key={c.key} className="find">
            <div className="find-head">
              <span className="find-title" style={{ fontSize: 16 }}>{c.name}</span>
              {c.openRoles ? <span className="badge b-ok">{c.openRoles} open in your feed{c.newRoles7d ? ` · ${c.newRoles7d} new this week` : ''}</span> : null}
              {mode === 'layoffs' && c.inYourTracker && <span className="badge b-err">⚠ in your Tracker</span>}
              {mode === 'hiring' && c.layoffs.length > 0 && <span className="badge b-warn">also had layoffs</span>}
            </div>
            {mode === 'hiring' ? c.hiring.slice(0, 4).map((h, i) => (
              <div key={i} className="tline">
                <span className={`badge ${CONF[h.confidence]}`}>{h.confidence}</span> <span className="badge b-dom">{h.region}</span> <span className="badge b-skip">{h.timeframe}</span> {h.kind !== 'news' && <span className="badge b-AIML">{h.kind === 'postings' ? 'from your job data' : 'funding'}</span>}
                {h.date && <span className="badge b-date">{dateLabel(h.date)}</span>}
                <div className="small" style={{ marginTop: 3 }}>{h.signal} {h.url && <a href={h.url} target="_blank" rel="noreferrer">{h.source || 'source'} ↗</a>}</div>
                <div className="small muted">Likely roles: {h.roles}</div>
              </div>
            )) : c.layoffs.slice(0, 4).map((l, i) => (
              <div key={i} className="tline">
                <span className="badge b-err">{l.count || 'cuts'}</span> <span className="badge b-dom">{l.region}</span> {l.aiRelated && <span className="badge b-AIML">AI-related</span>} <span className="badge b-date">{dateLabel(l.date)}</span>
                <div className="small" style={{ marginTop: 3 }}><b>Why:</b> {l.reason} <a href={l.url} target="_blank" rel="noreferrer">{l.source || 'source'} ↗</a></div>
                {l.teams && <div className="small"><b>Teams hit:</b> {l.teams}</div>}
                <div className="small"><b>Next:</b> {l.next}</div>
                {l.forYou && <div className="small" style={{ color: 'var(--accent)' }}><b>For you:</b> {l.forYou}</div>}
              </div>
            ))}
            {mode === 'hiring' && onOutreach && <div className="row" style={{ marginTop: 6 }}><button className="small-btn" onClick={() => onOutreach(c.name, 'Forward Deployed / AI Engineer')}>✉ Find people to email before the JD</button></div>}
          </div>
        ))}
        {!list.length && <div className="empty">{busy ? 'Reading this week’s news…' : scanned ? 'No companies match.' : 'Click “Rescan now”.'}</div>}
      </div>
    </>
  );
}
