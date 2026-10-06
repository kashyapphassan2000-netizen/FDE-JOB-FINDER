'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import ExportButton from './ExportButton';
import { ReachButton, SaveButton } from './ReachButton';

type Job = { title: string; company: string; location: string; url: string; postedAt?: string | null; salary?: string; via?: string };
type Post = { text: string; url: string; author: string; postedAt: string | null; likes?: number };
type JobsRes = { jobs?: Job[]; recent?: Job[]; blocked?: boolean; at: string; cached: boolean; error?: string; queries?: string[]; where?: string[] };
type PostsRes = { posts?: Post[]; recent?: Post[]; undated?: Post[]; other?: Post[]; needsKey?: boolean; free?: boolean; at: string; cached: boolean; error?: string; queries?: string[]; engines?: string[] };

/** Live, straight-from-the-platform results: LinkedIn jobs + LinkedIn posts, or X posts. Your words, as typed. 24 h first, then 1–7 days. */
export default function LiveFeed({ kind, query, toast }: { kind: 'li' | 'x'; query: string; toast: (s: string) => void }) {
  const [jobs, setJobs] = useState<JobsRes | null>(null);
  const [posts, setPosts] = useState<PostsRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState(query);
  useEffect(() => setQ(query), [query]);
  const load = useCallback(async (qq: string) => {
    setBusy(true);
    const u = (live: string) => `/api/agent?live=${live}&q=${encodeURIComponent(qq)}`;
    await Promise.all([
      kind === 'li' ? api<JobsRes>(u('li')).then(setJobs).catch((e) => toast(e.message)) : null,
      api<PostsRes>(u(kind === 'li' ? 'lip' : 'x')).then(setPosts).catch((e) => toast(e.message)),
    ]);
    setBusy(false);
  }, [kind, toast]);
  useEffect(() => { load(query); }, [load, query]);

  const postRow = (p: Post) => (
    <div key={p.url} className="tline">
      <b>{kind === 'x' ? `@${p.author}` : p.author || 'LinkedIn post'}</b> <span className="small muted">{p.postedAt ? `${ago(p.postedAt)} ago` : 'date unknown'}{p.likes ? ` · ♥ ${p.likes}` : ''}</span>
      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.text.slice(0, 600)}</div>
      <div className="row" style={{ gap: 6, marginTop: 4 }}>
        <a className="small-btn" href={p.url} target="_blank" rel="noreferrer">open post ↗</a>
        <ReachButton item={{ title: p.text.split('\n')[0].slice(0, 120), url: p.url, text: p.text, author: p.author }} toast={toast} />
        <SaveButton item={{ title: p.text.split('\n')[0].slice(0, 120), url: p.url, text: p.text, author: p.author }} toast={toast} />
      </div>
    </div>
  );
  const jobRow = (j: Job) => (
    <div key={j.url} className="tline"><b><a href={j.url} target="_blank" rel="noreferrer">{j.title} ↗</a></b> — {j.company} <span className="small muted">· {j.location} · {j.postedAt ? `posted ${ago(j.postedAt)} ago` : 'recent'}{j.salary ? ` · ${j.salary}` : ''} · {j.via}</span>
      <span className="row" style={{ gap: 6, display: 'inline-flex', marginLeft: 6 }}><ReachButton item={{ title: j.title, company: j.company, url: j.url, location: j.location }} toast={toast} /><SaveButton item={{ title: j.title, company: j.company, url: j.url, location: j.location }} toast={toast} folder="Saved jobs" /></span>
    </div>
  );
  const nJobs = (jobs?.jobs?.length || 0) + (jobs?.recent?.length || 0);
  const nPosts = (posts?.posts?.length || 0) + (posts?.recent?.length || 0);
  const all = [...(posts?.posts || []), ...(posts?.recent || [])];
  return (
    <div className="panel live-feed">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
          <span className="live-dot" /> {kind === 'li' ? 'LIVE LinkedIn — jobs + posts' : 'LIVE X — posts'} <span className="small muted">· {kind === 'li' ? `${nJobs} jobs · ` : ''}{nPosts} posts{posts && !posts.cached ? ' · just now' : posts ? ` · updated ${ago(posts.at)} ago` : ''}</span>
        </h3>
        <span className="row" style={{ gap: 6 }}>
          {all.length ? <ExportButton title={`${kind === 'x' ? 'X' : 'LinkedIn'} posts (live)`} sections={[{ title: 'Posts', headers: ['Posted', 'Author', 'Text', 'Link'], rows: all.map((p) => [(p.postedAt || '').slice(0, 16), p.author, p.text.slice(0, 500), p.url]) }]} /> : null}
          {kind === 'li' && nJobs ? <ExportButton title="LinkedIn jobs (live)" sections={[{ title: 'Jobs', headers: ['Title', 'Company', 'Location', 'Posted', 'Link'], rows: [...(jobs?.jobs || []), ...(jobs?.recent || [])].map((j) => [j.title, j.company, j.location, (j.postedAt || '').slice(0, 10), j.url]) }]} /> : null}
        </span>
      </div>
      {open && (
        <>
          <form className="row" style={{ gap: 6, margin: '8px 0' }} onSubmit={(e) => { e.preventDefault(); load(q); }}>
            <input className="grow" placeholder={kind === 'x' ? 'Type anything, e.g. “founders hiring AI engineers remote”' : 'Type anything, e.g. “ML engineer jobs in Berlin, remote ok”'} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="primary" disabled={busy}>{busy ? 'Searching…' : '⚡ Live search'}</button>
          </form>
          <p className="small muted" style={{ margin: '0 0 8px' }}>Searches <b>exactly your words</b>{jobs?.where?.length ? <> · jobs in <b>{jobs.where.join(', ')}</b></> : null}{posts?.engines?.length ? <> · posts via {posts.engines.join(', ')}</> : null}. Post times come from the post ID itself (exact, not a crawl date). {posts?.free ? 'Free mode (no paid X key): tweets appear once a search engine has seen them — usually minutes to hours.' : ''}</p>
          {jobs?.blocked && <div className="notice warn small">LinkedIn is rate-limiting this server right now (HTTP 429/999). It usually clears within the hour.</div>}
          {(posts?.error || jobs?.error) && <div className="notice warn small">{posts?.error || jobs?.error}</div>}
          {kind === 'li' && jobs && <>
            <h4 style={{ margin: '8px 0 4px' }}>Jobs — last 24 h ({jobs.jobs?.length || 0})</h4>
            {(jobs.jobs || []).slice(0, 60).map(jobRow)}
            {!jobs.jobs?.length && <div className="small muted">None posted in the last 24 h for this search.</div>}
            {!!jobs.recent?.length && <><h4 style={{ margin: '10px 0 4px' }}>Jobs — last 1–7 days ({jobs.recent.length})</h4>{jobs.recent.slice(0, 60).map(jobRow)}</>}
          </>}
          {posts && <>
            <h4 style={{ margin: '10px 0 4px' }}>Posts — last 24 h ({posts.posts?.length || 0})</h4>
            {(posts.posts || []).map(postRow)}
            {!posts.posts?.length && !busy && <div className="small muted">No matching post from the last 24 h has been indexed yet{posts.recent?.length ? ' — the latest ones are right below' : ''}.</div>}
            {!!posts.recent?.length && <><h4 style={{ margin: '10px 0 4px' }}>Posts — last 1–7 days ({posts.recent.length})</h4>{posts.recent.map(postRow)}</>}
            {!!posts.other?.length && <details style={{ marginTop: 8 }}><summary className="small muted">{posts.other.length} more matching posts without a hiring signal (news, opinions)</summary>{posts.other.map(postRow)}</details>}
            {!!posts.undated?.length && <details style={{ marginTop: 8 }}><summary className="small muted">{posts.undated.length} more that could not be verified (no provable date, or the post could not be opened)</summary>{posts.undated.map(postRow)}</details>}
          </>}
        </>
      )}
    </div>
  );
}
