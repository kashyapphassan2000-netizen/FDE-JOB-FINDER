import { NextResponse } from 'next/server';
import { SESSION_COOKIE, authConfigured, createSession } from '@/lib/auth';
import { checkPassword, getVersion } from '@/lib/access';

// Owner password login (password can be changed in Settings → Access).
export async function POST(req: Request) {
  if (!authConfigured()) return NextResponse.json({ error: 'APP_PASSWORD env var is not set on Vercel.' }, { status: 500 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down brute force
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }
  const s = await createSession('owner', 'owner', await getVersion());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: s.maxAge });
  return res;
}
