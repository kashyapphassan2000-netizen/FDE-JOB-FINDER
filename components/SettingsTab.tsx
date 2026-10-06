'use client';
import { useEffect, useState } from 'react';
import type { CompanyEntry, Settings } from '@/lib/types';
import { api } from './api';
import AccessPanel from './AccessPanel';

type DigestRes = { sent: boolean; count: number; to?: string; skipped?: string; ai?: string; picks: { id: string; title: string; company: string; total: number; cv: number; pay: string; url: string }[] };

const lines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

export default function SettingsTab({ toast }: { toast: (s: string) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [defaults, setDefaults] = useState<CompanyEntry[]>([]);
  const [slug, setSlug] = useState('');
  const [cname, setCname] = useState('');
  const [detected, setDetected] = useState<{ ats: CompanyEntry['ats']; count: number }[] | null>(null);
  const [cq, setCq] = useState('');
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [dg, setDg] = useState<DigestRes | null>(null);

  useEffect(() => {
    api<{ settings: Settings; defaultCompanies: CompanyEntry[] }>('/api/settings').then((r) => { setS(r.settings); setDefaults(r.defaultCompanies); }).catch((e) => toast(e.message));
    api<{ sources: { id: string; name: string }[] }>('/api/sources').then((r) => setSources(r.sources)).catch(() => {});
  }, [toast]);

  async function save(patch: Partial<Settings>) {
    try {
      const r = await api<{ settings: Settings }>('/api/settings', { method: 'POST', body: JSON.stringify(patch) });
      setS(r.settings);
      toast('Settings saved – applied on next refresh');
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function detect() {
    setDetected(null);
    try {
      const r = await api<{ matches: { ats: CompanyEntry['ats']; count: number }[] }>('/api/companies/detect', { method: 'POST', body: JSON.stringify({ slug, name: cname }) });
      setDetected(r.matches);
      if (!r.matches.length) toast('No public ATS board found for that slug. Try the slug from the company’s jobs URL (e.g. jobs.lever.co/<slug>).');
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function testAlert() {
    try {
      const r = await api<{ sent: number; error?: string; channels?: { email: boolean; whatsapp: boolean; telegram: boolean } }>('/api/notify/test', { method: 'POST' });
      const on = r.channels ? Object.entries(r.channels).filter(([, v]) => v).map(([k]) => k).join(', ') : '';
      toast(r.error ? `Problem: ${r.error}` : `Test alert sent via ${on || 'your channels'} — check your phone and inbox`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function digest(send: boolean) {
    setDg(null);
    try {
      const r = await api<DigestRes>('/api/digest', send ? { method: 'POST' } : undefined);
      setDg(r);
      toast(send ? (r.sent ? `Sent ${r.count} jobs to ${r.to}` : `Not sent: ${r.skipped}`) : `${r.count} jobs would be sent`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (!s) return <div className="panel muted">Loading…</div>;
  const allCompanies = [...defaults, ...s.extraCompanies];
  const key = (c: CompanyEntry) => `${c.ats}:${c.slug}`;

  return (
    <>
      <AccessPanel toast={toast} />
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Search keywords</h3>
        <p className="small muted">Used by LinkedIn, Adzuna, Jooble, JSearch, SerpApi and Apify (one per line). First = highest priority.</p>
        <textarea id="kw" defaultValue={s.keywords.join('\n')} />
        <div className="row" style={{ marginTop: 8 }}>
          <label className="grow small">Exclude titles containing (comma/line):<textarea id="ex" defaultValue={s.excludeTitleWords.join(', ')} style={{ minHeight: 50 }} /></label>
        </div>
        <div className="row">
          <label className="small">Alert when score ≥ <input id="alert" type="number" defaultValue={s.alertMinScore} style={{ width: 80 }} /></label>
          <button className="primary" onClick={() => save({
            keywords: lines((document.getElementById('kw') as HTMLTextAreaElement).value),
            excludeTitleWords: lines((document.getElementById('ex') as HTMLTextAreaElement).value),
            alertMinScore: Number((document.getElementById('alert') as HTMLInputElement).value),
          })}>Save</button>
          <button onClick={testAlert}>Send test alert</button>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>💬 WhatsApp alerts (free, 3 minutes)</h3>
        <ol className="small" style={{ margin: '0 0 8px', paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Save <b>+34 694 25 79 94</b> in your phone as “CallMeBot” (check the number on <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noreferrer">callmebot.com</a> — it changes sometimes).</li>
          <li>From your WhatsApp send it exactly: <code>I allow callmebot to send me messages</code></li>
          <li>You get a reply with your <b>apikey</b> (usually within 2 minutes).</li>
          <li>Open <b>Setup → AI &amp; Keys → Alerts</b>: set <b>WHATSAPP_PHONE</b> (country code + number, e.g. 919876543210) and <b>CALLMEBOT_APIKEY</b>.</li>
          <li>Click <b>Send test alert</b> above — the test job arrives on WhatsApp and email.</li>
        </ol>
        <p className="small muted">From then on every new FDE / AI job that matches your priorities (all sources, watched companies, agent posts) reaches you on WhatsApp too. CallMeBot is a free personal service with a few-second delay and rate limits; for a business number use Twilio (TWILIO_SID / TWILIO_TOKEN / TWILIO_WHATSAPP_FROM).</p>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Daily job email</h3>
        <p className="small muted">Every morning (~08:00 IST) the best fresh jobs are emailed to you: posted within the window below, ranked by CV fit (40%), pay (30%) and low competition (30%). A job is never emailed twice. Needs <b>RESEND_API_KEY</b> and <b>DIGEST_TO</b> in the “AI &amp; Keys” tab.</p>
        <div className="row">
          <label className="small">Jobs per email <input id="dgn" type="number" min={1} max={30} defaultValue={s.digestCount} style={{ width: 70 }} /></label>
          <label className="small">Posted within (hours) <input id="dgh" type="number" min={1} max={168} defaultValue={s.digestMaxAgeHours} style={{ width: 70 }} /></label>
          <button className="primary" onClick={() => save({ digestCount: Number((document.getElementById('dgn') as HTMLInputElement).value), digestMaxAgeHours: Number((document.getElementById('dgh') as HTMLInputElement).value) })}>Save</button>
          <button onClick={() => digest(false)}>Preview</button>
          <button onClick={() => digest(true)}>Send now</button>
        </div>
        {dg && (
          <div className="small" style={{ marginTop: 8 }}>
            {dg.skipped && <div className="notice warn">{dg.skipped}</div>}
            {dg.ai && <div className="muted">Matched to your CV by {dg.ai}</div>}
            <ol>{dg.picks.map((p) => <li key={p.id}><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> – {p.company} · CV {p.cv}% · {p.pay}</li>)}</ol>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Telegram channels & subreddits</h3>
        <div className="row">
          <label className="grow small">Public Telegram channels (no @):<textarea id="tg" defaultValue={s.telegramChannels.join('\n')} style={{ minHeight: 70 }} /></label>
          <label className="grow small">Subreddits (no r/):<textarea id="rd" defaultValue={s.subreddits.join('\n')} style={{ minHeight: 70 }} /></label>
        </div>
        <button className="primary" onClick={() => save({ telegramChannels: lines((document.getElementById('tg') as HTMLTextAreaElement).value), subreddits: lines((document.getElementById('rd') as HTMLTextAreaElement).value) })}>Save</button>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Sources on/off</h3>
        <div className="row">
          {sources.map((x) => (
            <label key={x.id} className="chip">
              <input type="checkbox" checked={!s.disabledSources.includes(x.id)} onChange={(e) => save({ disabledSources: e.target.checked ? s.disabledSources.filter((y) => y !== x.id) : [...s.disabledSources, x.id] })} /> {x.id}
            </label>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Companies watched directly ({allCompanies.length})</h3>
        <p className="small muted">Career boards polled straight from Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Workday. Add any company: type its slug (from its jobs URL) and auto-detect.</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <input placeholder="slug e.g. 'mistral' or 'groq'" value={slug} onChange={(e) => setSlug(e.target.value.trim())} />
          <input placeholder="Display name" value={cname} onChange={(e) => setCname(e.target.value)} />
          <button onClick={detect} disabled={!slug}>Auto-detect ATS</button>
          {detected?.map((m) => (
            <button key={m.ats} className="primary" onClick={() => { save({ extraCompanies: [...s.extraCompanies, { ats: m.ats, slug, name: cname || slug }] }); setDetected(null); setSlug(''); setCname(''); }}>
              Add via {m.ats} ({m.count} jobs)
            </button>
          ))}
        </div>
        <input placeholder="Filter companies…" value={cq} onChange={(e) => setCq(e.target.value)} style={{ marginBottom: 8 }} />
        <div className="row">
          {allCompanies.filter((c) => !cq || c.name.toLowerCase().includes(cq.toLowerCase())).map((c) => {
            const off = s.disabledCompanies.includes(key(c));
            const extra = s.extraCompanies.some((e) => key(e) === key(c));
            return (
              <span key={key(c)} className={`chip ${off ? '' : 'on'}`} title={`${c.ats}:${c.slug}${c.tag ? ` · ${c.tag}` : ''}`}
                onClick={() => save({ disabledCompanies: off ? s.disabledCompanies.filter((x) => x !== key(c)) : [...s.disabledCompanies, key(c)] })}>
                {c.name} <span className="muted">{c.ats}</span>
                {extra && <b onClick={(e) => { e.stopPropagation(); save({ extraCompanies: s.extraCompanies.filter((x) => key(x) !== key(c)) }); }}> ×</b>}
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}
