// Single-owner auth: one password (APP_PASSWORD) -> HMAC-signed session cookie.
// Uses Web Crypto so it works in both the proxy and route handlers.
export const SESSION_COOKIE = 'fj_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.APP_PASSWORD || '';
  return s;
}

async function hmac(data: string): Promise<string> {
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

export async function createSession(): Promise<{ value: string; maxAge: number }> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `owner.${exp}`;
  return { value: `${payload}.${await hmac(payload)}`, maxAge: MAX_AGE_SEC };
}

export async function verifySession(value: string | undefined | null): Promise<boolean> {
  if (!value || !secret()) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts;
  if (who !== 'owner' || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(`${who}.${exp}`));
}

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/** For route handlers: true if the request carries a valid session cookie. */
export async function isAuthed(req: Request): Promise<boolean> {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySession(m ? decodeURIComponent(m[1]) : null);
}

export function isCron(req: Request): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return false;
  const h = req.headers.get('authorization') || '';
  return safeEqual(h, `Bearer ${s}`);
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
