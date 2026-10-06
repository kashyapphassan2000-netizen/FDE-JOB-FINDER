'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';
import { bookmarklet } from '@/lib/applyfill';

type Profile = Record<string, string>;
type Field = { label: string; required: boolean; type: string; options: string[]; answer: string; needsYou: boolean; review?: boolean };
type Kit = { id: string; url: string; applyUrl: string; title: string; company: string; ats: string; fields: Field[]; coverLetter: string; status: 'ready' | 'queued' | 'applied' | 'skipped' | 'failed'; note?: string; updatedAt: string };
const PF: [string, string][] = [['firstName', 'First name'], ['lastName', 'Last name'], ['fullName', 'Full name'], ['email', 'Email'], ['phone', 'Phone (+91…)'], ['location', 'Location'], ['linkedin', 'LinkedIn URL'], ['github', 'GitHub URL'], ['website', 'Portfolio / website'], ['currentCompany', 'Current company'], ['currentTitle', 'Current title'], ['years', 'Years of experience'], ['noticePeriod', 'Notice period'], ['currentCtc', 'Current CTC'], ['expectedCtc', 'Expected CTC'], ['workAuth', 'Work authorization / visa'], ['relocate', 'Willing to relocate'], ['heardFrom', 'How did you hear about us'], ['pronouns', 'Pronouns (optional)']];
const STATUS: Record<Kit['status'], string> = { ready: '📝 ready', queued: '⏳ queued for runner', applied: '✅ applied', skipped: '⏭ skipped', failed: '⚠ failed' };

export default function ApplyTab({ toast, seedUrl }: { toast: (s: string) => void; seedUrl?: { url: string; title: string; company: string; n: number } | null }) {
  const [p, setP] = useState<Profile>({});
  const [kits, setKits] = useState<Kit[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [bm, setBm] = useState('');
  const [tok, setTok] = useState('');
  const load = useCallback(() => api<{ profile: Profile; kits: Kit[] }>('/api/apply').then((d) => { setP(d.profile); setKits(d.kits); }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  const prepare = useCallback(async (u: string, title = '', company = '') => {
    setBusy('kit');
    try { const r = await api<{ kit: Kit }>('/api/apply', { method: 'POST', body: JSON.stringify({ action: 'kit', url: u, title, company }) }); toast(`Kit ready: ${r.kit.fields.length} questions answered${r.kit.fields.some((f) => f.needsYou) ? ` — ${r.kit.fields.filter((f) => f.needsYou).length} need you` : ''}`); setOpen(r.kit.id); setUrl(''); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  }, [load, toast]);
  useEffect(() => { if (seedUrl?.url) prepare(seedUrl.url, seedUrl.title, seedUrl.company); }, [seedUrl, prepare]);
  async function act(body: Record<string, unknown>, ok: string) { try { await api('/api/apply', { method: 'POST', body: JSON.stringify(body) }); toast(ok); load(); } catch (e) { toast((e as Error).message); } }
  async function makeButton() {
    try {
      const r = await api<{ token: string }>('/api/studio', { method: 'POST', body: JSON.stringify({ action: 'mcp_create', label: 'Autofill + apply runner' }) });
      setTok(r.token);
      const embedded = Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'pitch'));
      setBm(bookmarklet(window.location.origin, r.token, embedded));
      toast('Your autofill button is ready — drag it to your bookmarks bar');
    } catch (e) { toast((e as Error).message); }
  }
  const editField = (k: Kit, i: number, answer: string) => setKits((ks) => ks.map((x) => (x.id === k.id ? { ...x, fields: x.fields.map((f, j) => (j === i ? { ...f, answer, needsYou: !answer && f.required } : f)) } : x)));
  const counts = { ready: kits.filter((k) => k.status === 'ready').length, queued: kits.filter((k) => k.status === 'queued').length, applied: kits.filter((k) => k.status === 'applied').length };
  return (
    <>
      <div className="hero">
        <div>
          <h2>Auto-apply — answers from your CV, forms filled for you</h2>
          <p>Paste any job link (Greenhouse, Ashby, Lever, Workday, careers pages). It reads the job’s <b>real application questions</b>, answers them from your CV and profile (unknowns are flagged, never invented) and writes a tailored cover note. Then one click on the application page fills everything — or the runner on your PC fills and submits your queued applications. Honest limits: captchas and file uploads on some sites need you; LinkedIn Easy Apply is not automated (it gets accounts banned).</p>
        </div>
        <div className="hero-stats"><div><b>{counts.ready}</b><span>ready</span></div><div><b>{counts.queued}</b><span>queued</span></div><div><b>{counts.applied}</b><span>applied</span></div></div>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>1 · Prepare an application</h3>
        <div className="row"><input className="grow" placeholder="Paste the job link — e.g. https://jobs.ashbyhq.com/cursor/…  or  https://job-boards.greenhouse.io/devrev/jobs/…" value={url} onChange={(e) => setUrl(e.target.value)} /><button className="primary" disabled={!url || busy === 'kit'} onClick={() => prepare(url)}>{busy === 'kit' ? 'Reading questions & writing answers… (~30-60 s)' : '⚡ Prepare'}</button></div>
        <p className="small muted">Tip: in Jobs, every card has ⚡ Apply — it lands here already prepared.</p>
      </div>
      {kits.map((k) => (
        <div key={k.id} className="panel">
          <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen(open === k.id ? null : k.id)}>
            <div><b>{k.title}</b> — {k.company} <span className="badge b-dom">{k.ats}</span> <span className="small">{STATUS[k.status]}</span>{k.fields.some((f) => f.needsYou) && <span className="badge b-warn">{k.fields.filter((f) => f.needsYou).length} need you</span>}<div className="small muted">{ago(k.updatedAt)} ago{k.note ? ` · ${k.note}` : ''}</div></div>
            <span className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <a className="small-btn" href={k.applyUrl} target="_blank" rel="noreferrer">Open form ↗</a>
              {k.status !== 'queued' && k.status !== 'applied' && <button className="small-btn primary" onClick={() => act({ action: 'edit', id: k.id, fields: k.fields, coverLetter: k.coverLetter }, 'Saved').then(() => act({ action: 'status', id: k.id, status: 'queued' }, 'Queued for the runner'))}>✓ Queue</button>}
              {k.status !== 'applied' && <button className="small-btn" onClick={() => act({ action: 'status', id: k.id, status: 'applied', note: 'marked applied by you' }, 'Marked applied')}>Mark applied</button>}
              <button className="small-btn danger" onClick={() => act({ action: 'delete', id: k.id }, 'Deleted')}>✕</button>
            </span>
          </div>
          {open === k.id && (
            <div style={{ marginTop: 10 }}>
              {k.fields.map((f, i) => (
                <div key={i} className={`ap-q ${f.needsYou ? 'need' : ''}`}>
                  <div className="small"><b>{f.label}</b>{f.required && <span style={{ color: '#e5484d' }}> *</span>} <span className="muted">{f.type}{f.options.length ? ` · ${f.options.slice(0, 6).join(' / ')}` : ''}</span>{f.needsYou && <span className="badge b-warn">needs you</span>}{f.review && !f.needsYou && <span className="badge b-dom">drafted from your CV — check every detail is true</span>}</div>
                  {/file/i.test(f.type) ? <div className="small muted">📎 attach your CV (the runner does it automatically)</div> : <textarea className="st-area" rows={f.answer.length > 120 ? 4 : 1} value={f.answer} onChange={(e) => editField(k, i, e.target.value)} placeholder={f.needsYou ? 'Fill this yourself' : ''} />}
                </div>
              ))}
              <label className="st-label">Cover note</label>
              <textarea className="st-area" rows={5} value={k.coverLetter} onChange={(e) => setKits((ks) => ks.map((x) => (x.id === k.id ? { ...x, coverLetter: e.target.value } : x)))} />
              <div className="row" style={{ marginTop: 6 }}><button className="primary" onClick={() => act({ action: 'edit', id: k.id, fields: k.fields, coverLetter: k.coverLetter }, 'Answers saved')}>Save answers</button><button onClick={() => navigator.clipboard.writeText(k.fields.filter((f) => f.answer).map((f) => `${f.label}\n${f.answer}`).join('\n\n') + `\n\nCover note\n${k.coverLetter}`).then(() => toast('All answers copied'))}>Copy all answers</button></div>
            </div>
          )}
        </div>
      ))}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>2 · One-click autofill on any application page</h3>
        <p className="small">Make your personal button once, drag it to your browser’s bookmarks bar, then on any application form click it: it fills every field it recognises with your profile and — if you prepared this job above — the job’s custom answers and cover note. You check, attach your CV and press Submit.</p>
        {!bm ? <button className="primary" onClick={makeButton}>Create my autofill button</button> : (
          <div className="row" style={{ alignItems: 'center' }}>
            <a className="google-btn" style={{ width: 'auto', padding: '8px 16px', background: '#00f0a0', color: '#08110d' }} ref={(el) => { if (el) el.setAttribute('href', bm); }} onClick={(e) => { e.preventDefault(); toast('Drag this button to your bookmarks bar (don’t click it here)'); }}>⚡ FDE Autofill</a>
            <span className="small muted">← drag me to the bookmarks bar (Ctrl/Cmd+Shift+B shows it). On phones use the runner or copy answers.</span>
          </div>
        )}
        <h3>3 · Fully automatic: the apply runner on your PC</h3>
        <p className="small">Fills every <b>queued</b> application in a real browser window, attaches your CV and — only if you add <code>--submit</code> — submits it. It stops for captchas and required questions you haven’t answered, and marks each job applied here. Max 10 per run.</p>
        <pre className="st-code">{`git clone <your repo> && cd FDE-JOB-FINDER && npm install
npm i -D playwright && npx playwright install chromium
APPLY_TOKEN=${tok || '<token from “Create my autofill button”>'} npm run apply                  # fill, you submit
APPLY_TOKEN=${tok || '<token>'} npm run apply -- --submit --max 5   # fill and submit`}</pre>
      </div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Your apply profile (used for every form)</h3>
          <span className="row" style={{ gap: 6 }}><button disabled={busy === 'cv'} onClick={async () => { setBusy('cv'); try { const r = await api<{ profile: Profile }>('/api/apply', { method: 'POST', body: JSON.stringify({ action: 'profile_from_cv' }) }); setP(r.profile); toast('Filled from your CV — check and save'); } catch (e) { toast((e as Error).message); } finally { setBusy(''); } }}>{busy === 'cv' ? 'Reading CV…' : '✨ Fill from my CV'}</button><button className="primary" onClick={() => act({ action: 'profile', profile: p }, 'Profile saved')}>Save profile</button></span></div>
        <div className="grid2" style={{ marginTop: 8 }}>{PF.map(([k, l]) => <label key={k} className="small">{l}<input style={{ width: '100%' }} value={p[k] || ''} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>)}</div>
        <label className="st-label">Short pitch (used in “why you” answers)</label>
        <textarea className="st-area" rows={3} value={p.pitch || ''} onChange={(e) => setP({ ...p, pitch: e.target.value })} />
      </div>
    </>
  );
}
