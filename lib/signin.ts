import { NextResponse } from 'next/server';
import { SESSION_COOKIE, createSession } from './auth';
import { accessUntil, getVersion, roleOf } from './access';

/** Puts a signed session cookie on the response. Time-limited users' cookie dies exactly when their access ends. */
export async function attachSession(res: NextResponse, email: string): Promise<boolean> {
  const role = await roleOf(email);
  if (!role) return false;
  const s = await createSession(email, role, await getVersion(), (await accessUntil(email)) ?? undefined);
  res.cookies.set(SESSION_COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: s.maxAge });
  return true;
}
