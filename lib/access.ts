import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { hmac, safeEqual, type Role, type Session } from './auth';
import { getJSON, hdel, hgetall, hset, setJSON } from './store';
import { secret } from './secrets';

/**
 * Access control (owner-managed).
 * - OWNER_EMAILS (Vercel env, comma separated) are owners. In lockdown ONLY they can get in.
 * - Owners add/remove member emails. Members sign in with an emailed link or a one-time invite link — never the password.
 * - The password (owner login) can be changed from the app; it is stored scrypt-hashed and overrides APP_PASSWORD.
 * - Changing the password or turning lockdown on bumps the session version → everyone else is signed out at once.
 */
export interface Member { email: string; role: Role; addedAt: string; addedBy: string; lastSeen?: string; expiresAt?: string | null; limits?: { actionsPerDay?: number; maxAgents?: number }; sv?: number }

/** Time-limited access: when does this member's access end (ms), or null = permanent. */
export async function accessUntil(email: string): Promise<number | null> {
  const m = (await hgetall<Member>('auth:members'))[email.trim().toLowerCase()];
  return m?.expiresAt ? Date.parse(m.expiresAt) : null;
}

export const ownerEmails = () => (process.env.OWNER_EMAILS || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
const norm = (e: string) => e.trim().toLowerCase();
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function getVersion() { return getJSON<number>('auth:ver', 1); }
export async function getLockdown() { return getJSON<boolean>('auth:lockdown', false); }
export async function members(): Promise<Member[]> {
  const m = await hgetall<Member>('auth:members');
  const owners: Member[] = ownerEmails().map((email) => ({ addedAt: m[email]?.addedAt || '', addedBy: 'OWNER_EMAILS', lastSeen: m[email]?.lastSeen, email, role: 'owner' }));
  return [...owners, ...Object.values(m).filter((x) => !ownerEmails().includes(x.email))];
}

export async function roleOf(email: string): Promise<Role | null> {
  const e = norm(email);
  if (e === 'owner' || ownerEmails().includes(e)) return 'owner';
  if (await getLockdown()) return null;
  const m = (await hgetall<Member>('auth:members'))[e];
  if (!m) return null;
  if (m.expiresAt && Date.now() > Date.parse(m.expiresAt)) return null; // time-limited access has ended
  return m.role;
}

export async function stillAllowed(s: Session): Promise<boolean> {
  if (s.ver !== (await getVersion())) return false;
  const r = await roleOf(s.email);
  if (!r) return false;
  // remember last activity (at most every 10 min)
  if (s.email !== 'owner') {
    const all = await hgetall<Member>('auth:members');
    const cur = all[s.email];
    if (cur && (!cur.lastSeen || Date.now() - Date.parse(cur.lastSeen) > 6e5)) await hset('auth:members', s.email, { ...cur, lastSeen: new Date().toISOString() });
  }
  return true;
}

// ---------- password ----------
export async function checkPassword(pw: string): Promise<boolean> {
  const stored = await getJSON<string | null>('auth:pw', null);
  if (stored) {
    const [salt, hash] = stored.split(':');
    const h = scryptSync(pw, salt, 32);
    return timingSafeEqual(h, Buffer.from(hash, 'hex'));
  }
  return Boolean(process.env.APP_PASSWORD) && safeEqual(pw, process.env.APP_PASSWORD!);
}

export async function setPassword(pw: string) {
  if (pw.length < 10) throw new Error('Use at least 10 characters');
  const salt = randomBytes(16).toString('hex');
  await setJSON('auth:pw', `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`);
  await bumpVersion();
}

export async function bumpVersion() {
  await setJSON('auth:ver', (await getVersion()) + 1);
}

// ---------- members ----------
export async function addMember(email: string, role: Role, by: string, hours?: number | null) {
  const e = norm(email);
  if (!isEmail(e)) throw new Error('Enter a valid email');
  if (role === 'owner' && !ownerEmails().includes(e)) throw new Error('Only the emails in OWNER_EMAILS can be owners (security rule)');
  const h = Number(hours) > 0 ? Math.min(24 * 365, Number(hours)) : null;
  if (!ownerEmails().includes(e)) {
    // seat caps (owner sets them in Access → Limits)
    const { getLimits } = await import('./limits');
    const lim = await getLimits();
    const all = await hgetall<Member>('auth:members');
    const live = Object.values(all).filter((m) => m.email !== e && !ownerEmails().includes(m.email) && (!m.expiresAt || Date.parse(m.expiresAt) > Date.now()));
    if (live.length >= lim.maxMembers) throw new Error(`Seat limit reached: ${live.length}/${lim.maxMembers} people have access. Remove someone or raise “Max people” in Access → Limits.`);
    if (h && live.filter((m) => m.expiresAt).length >= lim.maxTimed) throw new Error(`Time-limited seat limit reached (${lim.maxTimed}). Remove an expired/old guest or raise “Max time-limited guests”.`);
  }
  const prevM = (await hgetall<Member>('auth:members'))[e];
  await hset('auth:members', e, { ...(prevM?.limits ? { limits: prevM.limits } : {}), email: e, role: ownerEmails().includes(e) ? 'owner' : 'member', addedAt: new Date().toISOString(), addedBy: by, expiresAt: h && !ownerEmails().includes(e) ? new Date(Date.now() + h * 36e5).toISOString() : null });
}

/** Give more time (hours from now) or make permanent (null). Bumps nothing — the person stays signed in. */
export async function setMemberExpiry(email: string, hours: number | null) {
  const e = norm(email);
  const all = await hgetall<Member>('auth:members');
  if (!all[e]) throw new Error('Unknown member');
  const h = Number(hours) > 0 ? Math.min(24 * 365, Number(hours)) : null;
  await hset('auth:members', e, { ...all[e], expiresAt: h ? new Date(Date.now() + h * 36e5).toISOString() : null });
}

export async function setMemberLimits(email: string, limits: { actionsPerDay?: number | null; maxAgents?: number | null }) {
  const e = norm(email);
  const all = await hgetall<Member>('auth:members');
  if (!all[e]) throw new Error('Unknown member');
  const clean = (v: unknown, hi: number) => (v === null || v === undefined || v === '' ? undefined : Math.max(0, Math.min(hi, Math.round(Number(v)) || 0)));
  await hset('auth:members', e, { ...all[e], limits: { actionsPerDay: clean(limits.actionsPerDay, 1000), maxAgents: clean(limits.maxAgents, 50) } });
}

export async function removeMember(email: string) {
  const e = norm(email);
  if (ownerEmails().includes(e)) throw new Error('Owners cannot be removed (they are set in OWNER_EMAILS on Vercel)');
  await hdel('auth:members', e);
}

export async function setLockdown(on: boolean) {
  await setJSON('auth:lockdown', on);
  if (on) await bumpVersion();
}

// ---------- sign-in links ----------
/** Signed, single-use link token: email.expiry.nonce.sig */
export async function makeLinkToken(email: string, minutes: number): Promise<string> {
  const e = Buffer.from(norm(email)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + minutes * 60;
  const nonce = randomBytes(9).toString('base64url');
  const payload = `${e}.${exp}.${nonce}`;
  return `${payload}.${await hmac(`link.${payload}`)}`;
}

export async function consumeLinkToken(token: string): Promise<string | null> {
  const [e, exp, nonce, sig] = (token || '').split('.');
  if (!e || !exp || !nonce || !sig || Number(exp) < Date.now() / 1000) return null;
  if (!safeEqual(sig, await hmac(`link.${e}.${exp}.${nonce}`))) return null;
  const used = await hgetall<number>('auth:used');
  if (used[nonce]) return null; // single use
  await hset('auth:used', nonce, Date.now());
  return Buffer.from(e, 'base64url').toString('utf8');
}

export async function sendSignInEmail(to: string, link: string): Promise<'gmail' | 'resend' | 'none'> {
  const html = `<div style="font-family:system-ui,sans-serif"><h3>Sign in to FDE Job Finder</h3><p><a href="${link}" style="background:#00f0a0;color:#08110d;padding:10px 16px;border-radius:99px;text-decoration:none;font-weight:700">Sign in</a></p><p style="color:#666;font-size:13px">This link works once and expires in 20 minutes. If you didn't ask for it, ignore this email.</p></div>`;
  try {
    const { sendMail } = await import('./mailer');
    return (await sendMail(to, 'Your sign-in link', html)) as 'gmail' | 'resend';
  } catch {
    return 'none';
  }
}
