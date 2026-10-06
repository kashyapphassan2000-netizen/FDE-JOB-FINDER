'use client';
import { useEffect, useRef, useState } from 'react';

type Res = { host: string; jobs: number; posts: number; added: number; items: { kind: string; title: string; company: string; location: string; url: string }[]; note?: string; error?: string };

export default function Capture() {
  const [state, setState] = useState<'waiting' | 'reading' | 'done' | 'error'>('waiting');
  const [src, setSrc] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const got = useRef(false);

  useEffect(() => {
    const nonce = Math.random().toString(36).slice(2);
    const onMsg = async (e: MessageEvent) => {
      const m = e.data;
      if (got.current || !m || m.type !== 'fj-capture' || m.nonce !== nonce || !m.data?.u) return;
      got.current = true;
      setSrc(m.data.u);
      setState('reading');
      try {
        const r = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m.data) });
        if (r.status === 401) { window.location.href = '/login'; return; }
        const j = (await r.json()) as Res;
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        setRes(j);
        setState('done');
      } catch (err) {
        setRes({ host: '', jobs: 0, posts: 0, added: 0, items: [], error: (err as Error).message });
        setState('error');
      }
    };
    window.addEventListener('message', onMsg);
    // keep telling the page that opened us we are ready (its listener may attach a moment later)
    const iv = setInterval(() => { if (!got.current) window.opener?.postMessage({ type: 'fj-ready', nonce }, '*'); }, 400);
    const stop = setTimeout(() => { if (!got.current) setState('error'); }, 15000);
    return () => { window.removeEventListener('message', onMsg); clearInterval(iv); clearTimeout(stop); };
  }, []);

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="panel">
        <div className="brand" style={{ padding: '0 0 10px' }}><div className="brand-mark">F</div><div><b>Capture to FDE Job Finder</b><small>{src ? new URL(src).hostname : 'waiting for the page…'}</small></div></div>
        {state === 'waiting' && <p className="muted">Receiving the page…</p>}
        {state === 'reading' && <p>AI is reading the page and pulling out every job and hiring post (10–60 s)…</p>}
        {state === 'error' && <div className="notice err">{res?.error || 'Nothing received. Use the 📥 button from your bookmarks bar on a job / post page (pop-ups must be allowed for that site).'}</div>}
        {state === 'done' && res && (
          <>
            <div className="notice ok"><b>{res.jobs}</b> jobs and <b>{res.posts}</b> hiring posts found on {res.host} · <b>{res.added}</b> new jobs added to your list (Bengaluru / remote-India rule applied). Posts are in AI Agent → All saved finds.</div>
            {res.note && <div className="notice warn">{res.note}</div>}
            <ol className="small">{res.items.map((i) => <li key={i.url + i.title}><span className="badge b-skip">{i.kind}</span> <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> — {i.company} {i.location && <span className="muted">· {i.location}</span>}</li>)}</ol>
            <div className="row"><button className="primary" onClick={() => window.close()}>Close</button><a className="btn" href="/">Open my job portal</a></div>
          </>
        )}
      </div>
    </div>
  );
}
