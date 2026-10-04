import { NextResponse } from 'next/server';
import { hmac, safeEqual } from '@/lib/auth';
import { loadVault, secret } from '@/lib/secrets';
import { attachSession } from '@/lib/signin';

// Google redirects here. We check the signed state, swap the code (with our secret + PKCE verifier) for an ID token
// straight from Google over TLS, and only accept a verified Gmail/Google address that the owner gave access to.
export async function GET(req: Request) {
  await loadVault();
  const url = new URL(req.url);
  const fail = (e: string) => { const r = NextResponse.redirect(new URL(`/login?e=${e}`, url.origin)); r.cookies.set('fj_oauth', '', { path: '/api/auth/google', maxAge: 0 }); return r; };
  const ck = (req.headers.get('cookie') || '').match(/(?:^|;\s*)fj_oauth=([^;]+)/)?.[1];
  const [state, verifier, sig] = decodeURIComponent(ck || '').split('.');
  if (!state || !verifier || !sig || !safeEqual(sig, await hmac(`oauth.${state}.${verifier}`)) || !safeEqual(state, url.searchParams.get('state') || '')) return fail('google-state');
  const code = url.searchParams.get('code');
  if (!code) return fail('google-cancel');
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: secret('GOOGLE_CLIENT_ID'), client_secret: secret('GOOGLE_CLIENT_SECRET'), redirect_uri: `${url.origin}/api/auth/google/callback`, grant_type: 'authorization_code', code_verifier: verifier }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const tok = tr?.ok ? ((await tr.json()) as { id_token?: string }) : null;
  if (!tok?.id_token) return fail('google-token');
  let p: { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean };
  try { p = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8')); } catch { return fail('google-token'); }
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(p.iss || '') || p.aud !== secret('GOOGLE_CLIENT_ID') || !p.exp || p.exp * 1000 < Date.now() || !p.email || p.email_verified !== true) return fail('google-token');
  const res = NextResponse.redirect(new URL('/', url.origin));
  res.cookies.set('fj_oauth', '', { path: '/api/auth/google', maxAge: 0 });
  if (!(await attachSession(res, p.email.toLowerCase()))) return fail('noaccess');
  return res;
}
