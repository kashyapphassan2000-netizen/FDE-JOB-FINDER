// Auth: owner password OR per-person email access (sign-in link / one-time invite).
// Session cookie = base64url(email).role.version.expiry.hmac — signature checked everywhere (Web Crypto, works in the proxy);
// route handlers ALSO check the live access list (revoke / lockdown take effect immediately).
export const SESSION_COOKIE = 'fj_session';
export const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
export type Role = 'owner' | 'member';
export interface Session { email: string; role: Role; ver: number; exp: number }

function secret(): string {
  return process.env.AUTH_SECRET || process.env.APP_PASSWORD || '';
}

export async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export async function createSession(email: string, role: Role, ver: number, untilMs?: number): Promise<{ value: string; maxAge: number }> {
  // time-limited members: the cookie itself dies when their access ends
  const exp = Math.min(Math.floor(Date.now() / 1000) + MAX_AGE_SEC, untilMs ? Math.floor(untilMs / 1000) : Infinity);
  const payload = `${b64u(email.toLowerCase())}.${role}.${ver}.${exp}`;
  return { value: `${payload}.${await hmac(payload)}`, maxAge: Math.max(60, exp - Math.floor(Date.now() / 1000)) };
}

/** Signature + expiry only (cheap; used by the proxy). */
export async function verifySession(value: string | undefined | null): Promise<Session | null> {
  if (!value || !secret()) return null;
  const parts = value.split('.');
  if (parts.length !== 5) return null;
  const [e, role, ver, exp, sig] = parts;
  if ((role !== 'owner' && role !== 'member') || Number(exp) < Date.now() / 1000) return null;
  if (!safeEqual(sig, await hmac(`${e}.${role}.${ver}.${exp}`))) return null;
  try {
    return { email: unb64u(e), role, ver: Number(ver), exp: Number(exp) };
  } catch {
    return null;
  }
}

export function readCookie(req: Request): string | null {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** For route handlers: valid signature AND still allowed by the live access list. */
export async function currentUser(req: Request): Promise<Session | null> {
  const s = await verifySession(readCookie(req));
  if (!s) return null;
  const { stillAllowed } = await import('./access');
  return (await stillAllowed(s)) ? s : null;
}

export async function isAuthed(req: Request): Promise<boolean> {
  return Boolean(await currentUser(req));
}

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function isCron(req: Request): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return false;
  return safeEqual(req.headers.get('authorization') || '', `Bearer ${s}`);
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
