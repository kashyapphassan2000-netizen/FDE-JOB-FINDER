import { randomBytes } from 'node:crypto';
import { hdel, hgetall, hset } from './store';
import { universalSearch, type Hit } from './universal';
import { locationAllowed, locationTags } from './classify';
import { dateFromText, dateFromUrl } from './postdate';
import { esc, sendMail } from './mailer';
import { loadVault } from './secrets';

/**
 * Job alerts for other people: add anyone's email + the roles they want + where they can work.
 * Every day the app runs the same strategy it uses for you (every live board, ~230 company boards, agent finds,
 * X / LinkedIn posts, latest first, deduped, nothing sent twice) for THEIR roles and emails them the best links.
 */
export type Where = 'blr-remote' | 'remote' | 'city' | 'any';
export interface Subscriber {
  id: string; email: string; name?: string; roles: string[]; where: Where; city?: string; count: number; maxAgeH: number;
  exclude?: string[]; active: boolean; createdAt: string; owner?: string /* member who created it (self-serve alerts); empty = the owner */; lastSent?: string; lastResult?: string; sentIds?: string[];
}

const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function listSubs(): Promise<Subscriber[]> {
  return Object.values(await hgetall<Subscriber>('subs')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveSub(input: Partial<Subscriber>): Promise<Subscriber> {
  const email = String(input.email || '').trim().toLowerCase();
  if (!isEmail(email)) throw new Error('Enter a valid email');
  const roles = (input.roles || []).map((r) => String(r).trim()).filter(Boolean).slice(0, 5);
  if (!roles.length) throw new Error('Add at least one role they are looking for');
  const all = await hgetall<Subscriber>('subs');
  const cur = input.id ? all[input.id] : Object.values(all).find((s) => s.email === email && (s.owner || '') === (input.owner || ''));
  const s: Subscriber = {
    id: cur?.id || randomBytes(6).toString('hex'), email, name: String(input.name || cur?.name || '').slice(0, 60), roles,
    where: (['blr-remote', 'remote', 'city', 'any'] as Where[]).includes(input.where as Where) ? (input.where as Where) : 'blr-remote',
    city: String(input.city || '').slice(0, 60), count: Math.max(3, Math.min(25, Number(input.count) || 10)), maxAgeH: Math.max(24, Math.min(168, Number(input.maxAgeH) || 48)),
    exclude: (input.exclude || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 15),
    active: input.active !== false, owner: input.owner ?? cur?.owner, createdAt: cur?.createdAt || new Date().toISOString(), lastSent: cur?.lastSent, lastResult: cur?.lastResult, sentIds: cur?.sentIds || [],
  };
  await hset('subs', s.id, s);
  return s;
}

export async function deleteSub(id: string) { await hdel('subs', id); }

function whereOk(h: Hit, s: Subscriber): boolean {
  const loc = h.location || '';
  const tags = locationTags({ title: h.title, company: h.company, location: loc, url: h.url });
  if (s.where === 'any') return true;
  if (s.where === 'blr-remote') return !loc || locationAllowed(tags, loc);
  const remote = /remote|anywhere|worldwide|work from home|wfh/i.test(`${loc} ${h.title}`);
  if (s.where === 'remote') return remote && !tags.includes('REMOTE_FOREIGN');
  const city = (s.city || '').toLowerCase().trim();
  const alias: Record<string, string> = { bengaluru: 'bangalore', bangalore: 'bengaluru', gurugram: 'gurgaon', gurgaon: 'gurugram', mumbai: 'bombay' };
  return remote || Boolean(city && (`${loc} ${h.title}`.toLowerCase().includes(city) || (alias[city] && loc.toLowerCase().includes(alias[city]))));
}

const when = (h: Hit) => Date.parse(h.postedAt || '') || Date.parse(dateFromUrl(h.url) || dateFromText(`${h.title} ${h.text || ''}`) || '') || 0;

/** Search + pick for one person (no email). */
export async function picksFor(s: Subscriber): Promise<{ picks: (Hit & { t: number })[]; searched: number }> {
  const seen = new Set(s.sentIds || []);
  const out = new Map<string, Hit & { t: number }>();
  let searched = 0;
  for (const role of s.roles) {
    const r = await universalSearch(role, { ignoreLocation: true, budgetMs: 40000 }).catch(() => null);
    if (!r) continue;
    searched += r.boardsSearched;
    for (const h of r.hits) {
      const k = h.url.split('?')[0];
      if (seen.has(k) || out.has(k) || !whereOk(h, s)) continue;
      if (s.exclude?.some((x) => `${h.title} ${h.company}`.toLowerCase().includes(x))) continue;
      const t = when(h);
      if (t && Date.now() - t > s.maxAgeH * 36e5) continue; // older than they want
      out.set(k, { ...h, t });
    }
  }
  // dated + newest first, then undated company-board roles
  const picks = [...out.values()].sort((a, b) => (b.t ? 1 : 0) - (a.t ? 1 : 0) || b.t - a.t).slice(0, s.count);
  return { picks, searched };
}

function emailHtml(s: Subscriber, picks: (Hit & { t: number })[]) {
  const rows = picks.map((p) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee"><a href="${esc(p.url)}" style="font-weight:600;color:#0d1424;font-size:15px;text-decoration:none">${esc(p.title)}</a><div style="color:#555;font-size:13px">${esc(p.company)}${p.location ? ` · ${esc(p.location)}` : ''}${p.salary ? ` · ${esc(p.salary)}` : ''}</div><div style="color:#888;font-size:12px">${p.t ? `posted ${new Date(p.t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'open now'} · ${esc(p.source)}</div></td><td style="text-align:right;border-bottom:1px solid #eee"><a href="${esc(p.url)}" style="background:#00f0a0;color:#08110d;padding:7px 14px;border-radius:99px;text-decoration:none;font-weight:700;font-size:13px">Apply</a></td></tr>`).join('');
  return `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:640px;margin:auto"><div style="background:#0d1424;color:#fff;padding:18px 20px;border-radius:14px"><div style="font-size:18px;font-weight:700">${picks.length} fresh jobs for you${s.name ? `, ${esc(s.name)}` : ''}</div><div style="opacity:.8;font-size:13px">${esc(s.roles.join(' · '))} · ${s.where === 'blr-remote' ? 'Bengaluru office or remote (India)' : s.where === 'remote' ? 'remote' : s.where === 'city' ? `${esc(s.city || '')} or remote` : 'anywhere'} · newest first</div></div><table style="width:100%;border-collapse:collapse;margin-top:8px">${rows}</table><p style="color:#999;font-size:12px">Sent by FDE Job Finder. Each job is sent only once. Reply to stop these emails.</p></div>`;
}

/** Send one person their alert now (or dry-run to preview). */
export async function runSub(id: string, dryRun = false) {
  await loadVault();
  const s = (await hgetall<Subscriber>('subs'))[id];
  if (!s) throw new Error('Unknown subscriber');
  const { picks, searched } = await picksFor(s);
  if (dryRun) return { sent: false, picks, searched };
  let result: string;
  if (!picks.length) result = `no new jobs (${searched} sources searched)`;
  else {
    const via = await sendMail(s.email, `${picks.length} fresh ${s.roles[0]} jobs${picks.length ? ` · ${picks[0].company}` : ''} and more`, emailHtml(s, picks));
    result = `sent ${picks.length} jobs via ${via}`;
  }
  const next: Subscriber = { ...s, lastSent: new Date().toISOString(), lastResult: result, sentIds: [...picks.map((p) => p.url.split('?')[0]), ...(s.sentIds || [])].slice(0, 600) };
  await hset('subs', s.id, next);
  return { sent: picks.length > 0, picks, searched, result };
}

/** Cron: everyone who is due (last email > 20 h ago), within the time budget. */
export async function runDueSubs(budgetMs = 250000) {
  const t0 = Date.now();
  const due = (await listSubs()).filter((s) => s.active && (!s.lastSent || Date.now() - Date.parse(s.lastSent) > 20 * 36e5));
  const log: string[] = [];
  for (const s of due) {
    if (Date.now() - t0 > budgetMs) { log.push('time budget used — the rest go in the next run'); break; }
    try { const r = await runSub(s.id); log.push(`${s.email}: ${r.result}`); }
    catch (e) { const msg = (e as Error).message.slice(0, 160); log.push(`${s.email}: FAILED ${msg}`); await hset('subs', s.id, { ...s, lastResult: `failed: ${msg}` }); }
  }
  return { due: due.length, log };
}

