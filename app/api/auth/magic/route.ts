import { track } from '@/lib/obs';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, createSession } from '@/lib/auth';
import { accessUntil, consumeLinkToken, getVersion, makeLinkToken, roleOf, sendSignInEmail } from '@/lib/access';
import { loadVault } from '@/lib/secrets';
import { allow, clientIp } from '@/lib/ratelimit';

// POST {email} → if that email has access, email it a single-use sign-in link (same reply either way)
export async function POST(req: Request) {
  await loadVault();
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const e = (email || '').trim().toLowerCase();
  if (!(await allow('magic-ip', clientIp(req), 10, 3600)) || !(await allow('magic', e, 3, 900))) return NextResponse.json({ error: 'Too many requests — wait 15 minutes.' }, { status: 429 });
  await new Promise((r) => setTimeout(r, 400));
  if (e && (await roleOf(e))) {
    const link = `${new URL(req.url).origin}/api/auth/magic?t=${await makeLinkToken(e, 20)}`;
    await sendSignInEmail(e, link).catch(() => 'none' as const); // same reply either way: nobody can probe who has access
  }
  return NextResponse.json({ ok: true, note: 'If this email has access, a sign-in link is on its way (check spam).' });
}

// GET ?t=token → sign in (single use) and go to the app
export async function GET(req: Request) {
  const u = new URL(req.url);
  const email = await consumeLinkToken(u.searchParams.get('t') || '');
  const role = email ? await roleOf(email) : null;
  if (!email || !role) { await track('login', 'invite / email link', 'fail', 'expired, reused or access removed'); return NextResponse.redirect(new URL('/login?e=link', u.origin)); }
  await track('login', 'invite / email link', 'ok', email);
  const s = await createSession(email, role, await getVersion(), (await accessUntil(email)) ?? undefined);
  const res = NextResponse.redirect(new URL('/', u.origin));
  res.cookies.set(SESSION_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: s.maxAge });
  return res;
}
