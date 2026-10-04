import { track } from '@/lib/obs';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, authConfigured, createSession } from '@/lib/auth';
import { checkPassword, getVersion } from '@/lib/access';
import { allow, clientIp } from '@/lib/ratelimit';

// Owner password login (password can be changed in Settings → Access).
export async function POST(req: Request) {
  if (!authConfigured()) return NextResponse.json({ error: 'APP_PASSWORD env var is not set on Vercel.' }, { status: 500 });
  if (!(await allow('pw', clientIp(req), 8, 900))) return NextResponse.json({ error: 'Too many attempts — wait 15 minutes.' }, { status: 429 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await checkPassword(password))) {
    await track('login', 'owner password', 'fail', `wrong password from ${clientIp(req)}`);
    await new Promise((r) => setTimeout(r, 800)); // slow down brute force
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }
  await track('login', 'owner password', 'ok', clientIp(req));
  const s = await createSession('owner', 'owner', await getVersion());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: s.maxAge });
  return res;
}
