'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type Job = { title: string; company: string; location: string; url: string; postedAt?: string | null; salary?: string; via?: string };
type Post = { text: string; url: string; author: string; postedAt: string | null; likes?: number };
type Res = { jobs?: Job[]; posts?: Post[]; blocked?: boolean; needsKey?: boolean; at: string; cached: boolean; error?: string; queries?: string[]; query?: string };

/** Live, straight-from-the-platform results for the last 24 h (LinkedIn jobs / X posts). */
export default function LiveFeed({ kind, query, toast }: { kind: 'li' | 'x'; query: string; toast: (s: string) => void }) {
  const [d, setD] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const load = useCallback(async (q: string) => {
    setBusy(true);
    try { setD(await api<Res>(`/api/agent?live=${kind}&q=${encodeURIComponent(q)}`)); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }, [kind, toast]);
  useEffect(() => { load(query); }, [load, query]);
  const n = kind === 'li' ? d?.jobs?.length || 0 : d?.posts?.length || 0;
  return (
    <div className="panel live-feed">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
          <span className="live-dot" /> {kind === 'li' ? 'LIVE from LinkedIn — jobs posted in the last 24 h' : 'LIVE from X — hiring posts from the last 24 h'} {d && <span className="small muted">· {n} {d.cached ? `· updated ${ago(d.at)} ago` : '· just now'}</span>}
        </h3>
        <span className="row" style={{ gap: 6 }}>
          <button className="small-btn" disabled={busy} onClick={() => load(query)}>{busy ? 'Loading…' : '⟳ Live refresh'}</button>
          {kind === 'li' && d?.jobs?.length ? <ExportButton title="LinkedIn — last 24 h (live)" sections={[{ title: 'Jobs', headers: ['Title', 'Company', 'Location', 'Posted', 'Link'], rows: d.jobs.map((j) => [j.title, j.company, j.location, (j.postedAt || '').slice(0, 10), j.url]) }]} /> : null}
        </span>
      </div>
      {open && (
        <>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>{kind === 'li' ? <>Straight from LinkedIn’s public job search with its own “past 24 hours” filter — {d?.queries?.length ? <>for <b>{d.queries.join(' · ')}</b>, </> : null}Bengaluru + remote-India, newest first, interns / sales / agencies removed. Hiring <i>posts</i> (feed updates) are below — LinkedIn has no public live search for posts, so those come from web search and appear once search engines index them.</> : <>Straight from X search, last 24 h.</>}</p>
          {d?.needsKey && <div className="notice warn small"><b>X has no free live search.</b> Without a key, this tab can only find tweets once Google-style search engines index them (often a day or more late), which is why it looks empty. Add <b>TWITTERAPI_IO_KEY</b> in AI &amp; Keys (twitterapi.io, pay-as-you-go ~$0.15 per 1,000 tweets — a few rupees a day) and this panel shows every matching hiring tweet from the last 24 h, live.</div>}
          {d?.blocked && <div className="notice warn small">LinkedIn is rate-limiting this server right now (HTTP 429/999). It usually clears within the hour — try ⟳ Live refresh later.</div>}
          {d?.error && <div className="notice warn small">{d.error}</div>}
          {kind === 'li' && (d?.jobs || []).slice(0, 60).map((j) => (
            <div key={j.url} className="tline"><b><a href={j.url} target="_blank" rel="noreferrer">{j.title} ↗</a></b> — {j.company} <span className="small muted">· {j.location} · {j.postedAt ? `posted ${j.postedAt.slice(0, 10)}` : 'last 24 h'}{j.salary ? ` · ${j.salary}` : ''} · {j.via}</span></div>
          ))}
          {kind === 'x' && (d?.posts || []).map((p) => (
            <div key={p.url} className="tline"><b>@{p.author}</b> <span className="small muted">{p.postedAt ? `${ago(p.postedAt)} ago` : ''}{p.likes ? ` · ♥ ${p.likes}` : ''}</span><div className="small">{p.text.slice(0, 400)}</div><a className="small" href={p.url} target="_blank" rel="noreferrer">open post ↗</a></div>
          ))}
          {d && !n && !d.needsKey && !d.blocked && !busy && <div className="small muted">Nothing posted in the last 24 h for this search — that is the real answer right now.</div>}
        </>
      )}
    </div>
  );
}
