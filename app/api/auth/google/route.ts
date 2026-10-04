import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { hmac } from '@/lib/auth';
import { loadVault, secret } from '@/lib/secrets';
import { allow, clientIp } from '@/lib/ratelimit';

// "Continue with Google": OAuth 2.0 authorization-code flow with PKCE + signed state (CSRF-safe).
export async function GET(req: Request) {
  await loadVault();
  const origin = new URL(req.url).origin;
  const id = secret('GOOGLE_CLIENT_ID');
  if (!id || !secret('GOOGLE_CLIENT_SECRET')) return NextResponse.redirect(new URL('/login?e=google-off', origin));
  if (!(await allow('google-start', clientIp(req), 30, 900))) return NextResponse.redirect(new URL('/login?e=slow', origin));
  const state = randomBytes(18).toString('base64url');
  const verifier = randomBytes(40).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: id, redirect_uri: `${origin}/api/auth/google/callback`, response_type: 'code', scope: 'openid email', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  const res = NextResponse.redirect(u);
  const v = `${state}.${verifier}`;
  res.cookies.set('fj_oauth', `${v}.${await hmac(`oauth.${v}`)}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/google', maxAge: 600 });
  return res;
}
