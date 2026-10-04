'use client';
import { useCallback, useEffect, useState } from 'react';
import { ago, api } from './api';

type Contact = {
  id: string; name: string; role: string; email: string; confidence: 'verified' | 'found' | 'guess'; source: string; sourceUrl?: string; linkedin?: string;
  priority: number; status: 'new' | 'drafted' | 'sent' | 'replied' | 'skip'; draft?: { subject: string; body: string; model?: string; type?: string };
  kind?: 'hiring' | 'referrer'; sentAt?: string; followUps?: number;
};
type Lead = { id: string; company: string; domain: string; about: string; hiringFor?: string; contacts: Contact[]; people: { name: string; role: string; url: string }[]; log: string[]; updatedAt: string };
type Suggestion = { name: string; website?: string; why: string; roles: number };

const CONF: Record<Contact['confidence'], [string, string]> = {
  verified: ['b-ok', 'verified'],
  found: ['b-AIML', 'found public'],
  guess: ['b-warn', 'guess · unverified'],
};
const STATUS: Contact['status'][] = ['new', 'drafted', 'sent', 'replied', 'skip'];
const initials = (s: string) => (s || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const gmail = (to: string, su: string, body: string) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;

export default function OutreachTab({ toast, seed }: { toast: (s: string) => void; seed?: { company: string; role: string; n: number } | null }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => api<{ leads: Lead[]; suggestions: Suggestion[] }>('/api/outreach').then((r) => { setLeads(r.leads); setSugg(r.suggestions); }).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!seed?.company) return;
    setCompany(seed.company);
    setRole(seed.role);
    find(seed.company, undefined, seed.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  const put = (lead: Lead) => setLeads((ls) => [lead, ...(ls || []).filter((l) => l.id !== lead.id)]);

  async function find(name = company, domain?: string, forRole = role, mode: 'hiring' | 'referral' = 'hiring') {
    if (!name.trim()) return toast('Type a company name or website');
    setBusy('find');
    toast(`Searching ${name} — website, team pages, LinkedIn, web (20–60 s)…`);
    try {
      const r = await api<{ lead: Lead }>('/api/outreach', { method: 'POST', body: JSON.stringify({ action: 'find', company: name, domain, hiringFor: forRole || undefined, mode }) });
      put(r.lead);
      setOpen(r.lead.id);
      toast(`${r.lead.company}: ${r.lead.contacts.length} contacts (${r.lead.contacts.filter((c) => c.confidence !== 'guess').length} confirmed)`);
      setCompany('');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function act(body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const r = await api<{ lead?: Lead }>('/api/outreach', { method: 'POST', body: JSON.stringify(body) });
      if (r.lead) put(r.lead);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const patch = (l: Lead, c: Contact, p: Partial<Contact>) => act({ action: 'update', leadId: l.id, contactId: c.id, patch: p }, `u${c.id}`);
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast('Copied'));

  const shown = (leads || []).filter((l) => !q || `${l.company} ${l.domain}`.toLowerCase().includes(q.toLowerCase()));
  const sent = (leads || []).flatMap((l) => l.contacts).filter((c) => c.status === 'sent' || c.status === 'replied').length;
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = (leads || []).flatMap((l) => l.contacts).filter((c) => c.sentAt?.startsWith(today)).length;
  const due = (leads || []).flatMap((l) => l.contacts).filter((c) => c.status === 'sent' && c.sentAt && Date.now() - Date.parse(c.sentAt) > 5 * 864e5 && (c.followUps || 0) < 2).length;
  const replied = (leads || []).flatMap((l) => l.contacts).filter((c) => c.status === 'replied').length;

  return (
    <>
      <div className="hero">
        <div>
          <h2>Reach the people who hire</h2>
          <p>Find founders, CTOs, engineering managers and recruiters at any company, get their work email, and send a short AI-drafted note built from your CV. You review every email and press send yourself.</p>
        </div>
        <div className="hero-stats">
          <div><b>{leads?.length ?? '–'}</b><span>companies</span></div>
          <div><b>{sent}</b><span>emails sent</span></div>
          <div><b>{replied}</b><span>replies</span></div>
          <div className={sentToday > 10 ? 'warn' : ''}><b>{sentToday}</b><span>sent today</span></div>
          <div className={due ? 'warn' : ''}><b>{due}</b><span>follow-ups due</span></div>
        </div>
      </div>

      <div className="panel">
        <div className="row">
          <input className="grow big" placeholder="Company name or website — e.g. Sarvam AI, bolna.ai" value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
          <input className="grow" placeholder="Role you want (optional) — e.g. Forward Deployed Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
          <button className="primary" disabled={!!busy} onClick={() => find()}>{busy === 'find' ? 'Searching…' : 'Find contacts'}</button>
        </div>
        {sugg.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>Newly funded and hiring startups (from the Hidden jobs scan). Click one to find its people:</div>
            <div className="row">
              {sugg.slice(0, 16).map((s) => (
                <span key={s.name} className="chip" title={s.why} onClick={() => !busy && find(s.name, s.website)}>
                  {s.name}{s.roles ? <b className="chip-n">{s.roles}</b> : null}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="hint">
          <b>How the emails are found:</b> addresses published on the company site and on the web are marked <span className="badge b-AIML">found public</span>. With a Hunter.io key (AI &amp; Keys, 25 free searches a month) you also get <span className="badge b-ok">verified</span> ones. For people found on LinkedIn/X with no public email, the app builds a <span className="badge b-warn">guess · unverified</span> from the usual pattern (first@company), which is right for many startups but not all. <b>Rules from your Excel:</b> email the engineering manager (not HR) 3–5 days after applying on the portal; send Tue–Thu 9–11 AM their time; 75–120 words; one follow-up after 5–7 days, then move on after two; 5–10 personal emails a day at most (more gets Gmail flagged). For referrals ask mid-level engineers, not recruiters — and note Anthropic has no referral bonus, so only people who know your work will refer you there.
        </div>
      </div>

      {leads && leads.length > 3 && <input className="search" placeholder="Filter companies…" value={q} onChange={(e) => setQ(e.target.value)} />}
      {leads && !leads.length && <div className="empty">No companies yet. Type one above or click a suggested startup.</div>}

      {shown.map((l) => {
        const isOpen = open === l.id;
        const best = l.contacts.filter((c) => c.status !== 'skip');
        return (
          <div key={l.id} className={`lead ${isOpen ? 'open' : ''}`}>
            <div className="lead-head" onClick={() => setOpen(isOpen ? null : l.id)}>
              <div className="logo">{initials(l.company)}</div>
              <div className="grow">
                <div className="lead-title">{l.company} <a className="small" href={`https://${l.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{l.domain} ↗</a></div>
                <div className="small muted clamp">{l.about || l.log.join(' · ')}</div>
              </div>
              <div className="lead-meta">
                <span className="badge b-ok">{l.contacts.filter((c) => c.confidence !== 'guess').length} confirmed</span>
                <span className="badge b-warn">{l.contacts.filter((c) => c.confidence === 'guess').length} guessed</span>
                <span className="small muted">{ago(l.updatedAt)}</span>
                <span className="caret">{isOpen ? '▾' : '▸'}</span>
              </div>
            </div>
            {isOpen && (
              <div className="lead-body">
                {!best.length && <div className="empty small">No emails found. Try the company’s exact website (e.g. acme.ai), add a Hunter.io key, or message the people below on LinkedIn.</div>}
                {best.map((c) => (
                  <div key={c.id} className="contact">
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <div className="avatar">{initials(c.name || c.email)}</div>
                      <div className="grow">
                        <div><b>{c.name || c.role || 'Inbox'}</b>{c.name && c.role ? <span className="muted"> · {c.role}</span> : null}{c.kind === 'referrer' && <span className="badge b-SEMI" style={{ marginLeft: 6 }}>referrer</span>}{c.status === 'sent' && c.sentAt && <FollowBadge c={c} />}</div>
                        <div className="row small" style={{ gap: 6 }}>
                          <span className="mono">{c.email}</span>
                          <button className="link" onClick={() => copy(c.email)}>copy</button>
                          <span className={`badge ${CONF[c.confidence][0]}`}>{CONF[c.confidence][1]}</span>
                          {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer">source</a>}
                          {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer">profile</a>}
                        </div>
                      </div>
                      <select value={c.status} onChange={(e) => patch(l, c, { status: e.target.value as Contact['status'] })}>
                        {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button className="primary small-btn" disabled={!!busy} onClick={() => act({ action: 'draft', leadId: l.id, contactId: c.id }, `d${c.id}`)}>
                        {busy === `d${c.id}` ? 'Writing…' : c.status === 'sent' ? '↻ Draft follow-up' : c.kind === 'referrer' ? (c.draft ? 'Rewrite' : '🤝 Ask referral') : c.draft ? 'Rewrite' : '✨ Draft email'}
                      </button>
                    </div>
                    {c.draft && <Draft lead={l} c={c} onSave={(d) => patch(l, c, { draft: d })} onSent={() => patch(l, c, { status: 'sent' })} copy={copy} />}
                  </div>
                ))}
                {l.people.length > 0 && (
                  <div className="small" style={{ marginTop: 10 }}>
                    <span className="muted">People found (DM them on LinkedIn/X too): </span>
                    {l.people.map((p) => <a key={p.name} className="pill" href={p.url || '#'} target="_blank" rel="noreferrer">{p.name}{p.role ? ` · ${p.role.slice(0, 40)}` : ''}</a>)}
                  </div>
                )}
                <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                  <span className="small muted">{l.log.join(' · ')}</span>
                  <span className="row">
                    <button className="small-btn" disabled={!!busy} onClick={() => find(l.company, l.domain, l.hiringFor || role, 'referral')} title="Mid-level engineers at this company who can refer you (Excel Referral_System: ask ICs, not recruiters)">🤝 Find referrers</button>
                    <button className="small-btn" disabled={!!busy} onClick={() => find(l.company, l.domain)}>Search again</button>
                    <button className="small-btn danger" onClick={() => act({ action: 'delete', leadId: l.id }, 'del').then(load)}>Remove</button>
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Draft({ lead, c, onSave, onSent, copy }: { lead: Lead; c: Contact; onSave: (d: Contact['draft']) => void; onSent: () => void; copy: (s: string) => void }) {
  const [su, setSu] = useState(c.draft!.subject);
  const [body, setBody] = useState(c.draft!.body);
  useEffect(() => { setSu(c.draft!.subject); setBody(c.draft!.body); }, [c.draft]);
  const dirty = su !== c.draft!.subject || body !== c.draft!.body;
  return (
    <div className="draft">
      <input value={su} onChange={(e) => setSu(e.target.value)} placeholder="Subject" />
      <textarea className="prompt" value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
      <div className="row">
        <a className="btn primary" href={gmail(c.email, su, body)} target="_blank" rel="noreferrer" onClick={onSent}>Open in Gmail ↗</a>
        <a className="btn" href={`mailto:${c.email}?subject=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`} onClick={onSent}>Mail app</a>
        <button onClick={() => copy(`${su}\n\n${body}`)}>Copy</button>
        {dirty && <button onClick={() => onSave({ subject: su, body, model: c.draft!.model })}>Save edits</button>}
        <span className="small muted">To {c.email} · {lead.company}{c.draft!.model ? ` · written by ${c.draft!.model}` : ''}</span>
      </div>
    </div>
  );
}

function FollowBadge({ c }: { c: Contact }) {
  const days = Math.floor((Date.now() - Date.parse(c.sentAt!)) / 864e5);
  if ((c.followUps || 0) >= 2) return <span className="badge b-skip" style={{ marginLeft: 6 }}>2 follow-ups sent — move on</span>;
  if (days >= 5) return <span className="badge b-err" style={{ marginLeft: 6 }}>follow-up due ({days}d)</span>;
  return <span className="badge b-ok" style={{ marginLeft: 6 }}>sent {days}d ago{c.followUps ? ` · ${c.followUps} follow-up` : ''}</span>;
}
