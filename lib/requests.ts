import { hmac, safeEqual } from './auth';
import { hgetall, hset, hdel } from './store';
import { addMember } from './access';
import { esc, sendImportant, sendMail } from './mailer';
import { track } from './obs';

/**
 * Anyone, anywhere can ask for access from the login page. The owner gets an important email with one-click
 * "Approve 1 h / 24 h / 7 days / permanent" links (HMAC-signed, 7-day expiry, single use) — or approves in Access.
 */
export interface AccessRequest { email: string; name: string; role: string; location: string; situation: string; at: string; status: 'pending' | 'approved' | 'denied'; hours?: number | null }
const DAY = 864e5;

export async function listRequests(): Promise<AccessRequest[]> {
  return Object.values(await hgetall<AccessRequest>('access:requests')).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
}

async function sig(email: string, hours: number, exp: number) { return (await hmac(`approve.${email}.${hours}.${exp}`)).slice(0, 40); }

export async function createRequest(r: Omit<AccessRequest, 'at' | 'status'>, origin: string) {
  const all = await hgetall<AccessRequest>('access:requests');
  if (all[r.email]?.status === 'approved') return; // already in
  await hset('access:requests', r.email, { ...r, at: new Date().toISOString(), status: 'pending' });
  const exp = Date.now() + 7 * DAY;
  const link = async (h: number) => `${origin}/api/auth/approve?e=${encodeURIComponent(r.email)}&h=${h}&x=${exp}&s=${await sig(r.email, h, exp)}`;
  const btn = (href: string, label: string, bg: string) => `<a href="${href}" style="display:inline-block;margin:4px 6px 4px 0;padding:9px 14px;border-radius:8px;background:${bg};color:#fff;text-decoration:none;font-weight:600">${label}</a>`;
  await sendImportant(`Access request: ${r.name || r.email} (${r.role || 'role not given'}, ${r.location || 'location not given'})`,
    `<div style="font-family:system-ui,sans-serif;max-width:620px"><p><b>${esc(r.name || '(no name)')}</b> &lt;${esc(r.email)}&gt; wants access to FDE Job Finder.</p>
<table style="font-size:14px"><tr><td style="color:#666;padding-right:10px">Target role</td><td>${esc(r.role || '—')}</td></tr><tr><td style="color:#666;padding-right:10px">Location</td><td>${esc(r.location || '—')}</td></tr><tr><td style="color:#666;padding-right:10px;vertical-align:top">Situation</td><td>${esc(r.situation || '—')}</td></tr></table>
<p>${btn(await link(0), '✅ Approve permanently', '#0a7')}${btn(await link(168), 'Approve 7 days', '#2563eb')}${btn(await link(24), 'Approve 24 h', '#2563eb')}${btn(await link(1), 'Approve 1 h', '#6b7280')}</p>
<p style="color:#888;font-size:12px">One click adds them and emails them how to sign in. Links work once, for 7 days. Or approve/deny in the app: Settings → Access.</p></div>`);
  await track('login', 'access requested', 'ok', `${r.email} · ${r.role} · ${r.location}`);
}

export async function approveFromLink(email: string, hours: number, exp: number, s: string, origin: string): Promise<string> {
  if (!email || !Number.isFinite(exp) || Date.now() > exp) throw new Error('This approve link has expired — approve in the app (Access) instead.');
  if (!safeEqual(s, await sig(email, hours, exp))) throw new Error('Invalid approve link.');
  const req = (await hgetall<AccessRequest>('access:requests'))[email];
  if (req?.status === 'approved') return `${email} already has access.`;
  return approve(email, hours || null, origin);
}

export async function approve(email: string, hours: number | null, origin: string): Promise<string> {
  await addMember(email, 'member', 'owner (request)', hours);
  const req = (await hgetall<AccessRequest>('access:requests'))[email];
  if (req) await hset('access:requests', email, { ...req, status: 'approved', hours });
  const until = hours ? ` for ${hours >= 24 ? `${Math.round(hours / 24)} day(s)` : `${hours} hour(s)`}` : '';
  await sendMail(email, 'You have access to FDE Job Finder', `<div style="font-family:system-ui,sans-serif;max-width:560px"><p>Hi${req?.name ? ` ${esc(req.name)}` : ''} — your access is approved${until}.</p><p><a href="${origin}/login" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600">Sign in</a></p><p style="color:#555;font-size:14px">Sign in with this Gmail (Google button) or get a 6-digit code by email. Then: set your target role and city in <b>Life → My role</b>, search any role anywhere in the top bar, add job alerts to your email, and use 🎯 Reach decision-maker on any job.</p></div>`).catch(() => null);
  await track('login', 'access approved', 'ok', `${email}${until}`);
  return `${email} approved${until}. They were emailed how to sign in.`;
}

export async function deny(email: string) {
  const req = (await hgetall<AccessRequest>('access:requests'))[email];
  if (req) await hset('access:requests', email, { ...req, status: 'denied' });
}
export async function clearRequest(email: string) { await hdel('access:requests', email); }
