'use client';
import { useEffect, useState } from 'react';
import type { CvVersion } from '@/lib/types';
import { api } from './api';

type Cv = { versions: CvVersion[]; active: string | null; skills: string[]; textChars: number; preview: string; blob?: boolean };

export default function CvTab({ toast }: { toast: (s: string) => void }) {
  const [cv, setCv] = useState<Cv | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Cv>('/api/cv').then(setCv).catch((e) => toast(e.message));
  }, [toast]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('skills', extra);
      const r = await api<Cv>('/api/cv', { method: 'POST', body: fd });
      setCv({ ...r, blob: true });
      setFile(null);
      toast(`CV uploaded · ${r.skills.length} skills detected · job CV-match updates on the next refresh`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function patch(body: object, msg: string) {
    try {
      const r = await api<Cv>('/api/cv', { method: 'PATCH', body: JSON.stringify(body) });
      setCv({ ...cv!, ...r });
      toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function remove(p: string) {
    if (!confirm('Delete this CV version permanently?')) return;
    const r = await api<Cv>('/api/cv', { method: 'DELETE', body: JSON.stringify({ pathname: p }) });
    setCv({ ...cv!, ...r });
  }

  if (!cv) return <div className="panel muted">Loading…</div>;
  const active = cv.versions.find((v) => v.pathname === cv.active);

  return (
    <>
      {cv.blob === false && <div className="notice err">Vercel Blob is not connected yet – uploads will fail. Vercel → Storage → Create → <b>Blob</b> → access <b>Private</b> → connect to this project → redeploy.</div>}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Upload / update CV</h3>
        <p className="small muted">Stored in a <b>private</b> Vercel Blob store — no public URL; only your logged-in session can view/download it. Every upload is kept as a version.</p>
        <div className="row">
          <input type="file" accept=".pdf,.docx,.doc,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <input className="grow" placeholder="Extra skills to match on (comma separated, optional)" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <button className="primary" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload CV'}</button>
        </div>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Active CV</h3>
        {active ? (
          <>
            <div className="row">
              <b>{active.name}</b> <span className="muted small">{(active.size / 1024).toFixed(0)} KB · uploaded {new Date(active.uploadedAt).toLocaleString()}</span>
              <a href={`/api/cv/download?p=${encodeURIComponent(active.pathname)}`} target="_blank" rel="noreferrer"><button>View</button></a>
              <a href={`/api/cv/download?p=${encodeURIComponent(active.pathname)}&dl=1`}><button>Download</button></a>
            </div>
            <p className="small muted">{cv.textChars} characters extracted · {cv.skills.length} skills used for CV-match scoring:</p>
            <div>{cv.skills.map((s) => <span key={s} className="badge b-AIML">{s}</span>)}</div>
            <details style={{ marginTop: 8 }}>
              <summary className="small">Edit match skills</summary>
              <textarea defaultValue={cv.skills.join(', ')} id="skills" />
              <button onClick={() => patch({ skills: (document.getElementById('skills') as HTMLTextAreaElement).value }, 'Skills saved – re-scored on next refresh')}>Save skills</button>
            </details>
          </>
        ) : (
          <p className="muted">No CV uploaded yet.</p>
        )}
      </div>
      {cv.versions.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Version</th><th>Uploaded</th><th>Size</th><th></th></tr></thead>
            <tbody>
              {cv.versions.map((v) => (
                <tr key={v.pathname}>
                  <td>{v.name} {v.pathname === cv.active && <span className="badge b-ok">active</span>}</td>
                  <td className="small">{new Date(v.uploadedAt).toLocaleString()}</td>
                  <td className="small">{(v.size / 1024).toFixed(0)} KB</td>
                  <td className="row">
                    <a href={`/api/cv/download?p=${encodeURIComponent(v.pathname)}&dl=1`}><button>Download</button></a>
                    {v.pathname !== cv.active && <button onClick={() => patch({ active: v.pathname }, 'Active CV switched')}>Make active</button>}
                    <button className="danger" onClick={() => remove(v.pathname)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
