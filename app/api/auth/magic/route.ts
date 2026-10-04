import { NextResponse } from 'next/server';
import { SESSION_COOKIE, createSession } from '@/lib/auth';
import { consumeLinkToken, getVersion, makeLinkToken, roleOf, sendSignInEmail } from '@/lib/access';
import { loadVault } from '@/lib/secrets';

// POST {email} → if that email has access, email it a single-use sign-in link (same reply either way)
export async function POST(req: Request) {
  await loadVault();
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const e = (email || '').trim().toLowerCase();
  await new Promise((r) => setTimeout(r, 400));
  if (e && (await roleOf(e))) {
    const link = `${new URL(req.url).origin}/api/auth/magic?t=${await makeLinkToken(e, 20)}`;
    const via = await sendSignInEmail(e, link).catch(() => 'none' as const);
    if (via === 'none') return NextResponse.json({ ok: true, note: 'Email sending is not set up for this address yet — ask the owner for an invite link.' });
  }
  return NextResponse.json({ ok: true, note: 'If this email has access, a sign-in link is on its way (check spam).' });
}

// GET ?t=token → sign in (single use) and go to the app
export async function GET(req: Request) {
  const u = new URL(req.url);
  const email = await consumeLinkToken(u.searchParams.get('t') || '');
  const role = email ? await roleOf(email) : null;
  if (!email || !role) return NextResponse.redirect(new URL('/login?e=link', u.origin));
  const s = await createSession(email, role, await getVersion());
  const res = NextResponse.redirect(new URL('/', u.origin));
  res.cookies.set(SESSION_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: s.maxAge });
  return res;
}
