// Auth: owner password OR per-person email access (sign-in link / one-time invite).
// Session cookie = base64url(email).role.version.expiry.hmac — signature checked everywhere (Web Crypto, works in the proxy);
// route handlers ALSO check the live access list (revoke / lockdown take effect immediately).
import { enterTenant, OWNER, tenantFor, type Tenant } from './tenant';
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

const verified = new WeakMap<Request, Tenant>();
/**
 * Call right after the auth check, in the route's own body: the rest of this request runs as that user
 * (their own CV, tracker, priorities, graph …). Without it personal data is empty (fail-closed), never the owner's.
 */
export function bindTenant(req: Request) {
  const t = verified.get(req);
  if (t) enterTenant(t);
}

/** For route handlers: valid signature AND still allowed by the live access list. */
export async function currentUser(req: Request): Promise<Session | null> {
  const s = await verifySession(readCookie(req));
  if (!s) return null;
  const { stillAllowed, ownerEmails } = await import('./access');
  if (!(await stillAllowed(s))) return null;
  // the rest of this request runs as this user: personal data resolves to their own copy (lib/tenant.ts)
  const t = tenantFor(s.email, ownerEmails());
  verified.set(req, t);
  enterTenant(t);
  return s;
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
  const ok = safeEqual(req.headers.get('authorization') || '', `Bearer ${s}`);
  if (ok) enterTenant(OWNER); // scheduled jobs work on the owner's data (sync → applies to this request only)
  return ok;
}

/**
 * GitHub Actions without a stored secret: each run asks GitHub for a short-lived signed token (OIDC, ~5 min).
 * Accepted only if GitHub signed it (RS256, GitHub's public keys), it is for this app (audience), not expired,
 * and it comes from THIS repo's refresh workflow file. Nothing to copy, nothing to leak.
 */
const GH_ISS = 'https://token.actions.githubusercontent.com';
export const GH_OIDC_AUD = 'fde-job-finder-cron';
const GH_REPO = (process.env.GH_ACTIONS_REPO || 'kashyapphassan2000-netizen/FDE-JOB-FINDER').toLowerCase();
let ghKeys: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;
const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
async function githubKey(kid: string, fresh = false) {
  if (fresh || !ghKeys || Date.now() - ghKeys.at > 36e5) {
    const r = await fetch(`${GH_ISS}/.well-known/jwks`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`jwks ${r.status}`);
    ghKeys = { at: Date.now(), keys: ((await r.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys || [] };
  }
  return ghKeys.keys.find((k) => k.kid === kid);
}
export async function isGithubActions(req: Request): Promise<boolean> {
  const tok = req.headers.get('x-github-oidc') || '';
  const [h, p, sig] = tok.split('.');
  if (!h || !p || !sig) return false;
  try {
    const head = b64urlJson(h) as { alg?: string; kid?: string };
    const c = b64urlJson(p) as { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; repository?: string; workflow_ref?: string };
    const now = Date.now() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (head.alg !== 'RS256' || !head.kid || c.iss !== GH_ISS || !aud.includes(GH_OIDC_AUD)) return false;
    if (!c.exp || c.exp < now || (c.nbf && c.nbf > now + 60)) return false;
    if ((c.repository || '').toLowerCase() !== GH_REPO || !(c.workflow_ref || '').toLowerCase().startsWith(`${GH_REPO}/.github/workflows/refresh.yml@`)) return false;
    const jwk = (await githubKey(head.kid)) || (await githubKey(head.kid, true)); // GitHub rotates keys
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    if (ok) enterTenant(OWNER);
    return ok;
  } catch {
    return false;
  }
}
/** Scheduled callers: Vercel cron / anything with CRON_SECRET, or this repo's GitHub workflow via OIDC. */
export async function isCronAsync(req: Request): Promise<boolean> {
  return isCron(req) || (await isGithubActions(req));
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
