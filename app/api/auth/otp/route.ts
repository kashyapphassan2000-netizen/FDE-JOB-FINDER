import { NextResponse } from 'next/server';
import { loadVault } from '@/lib/secrets';
import { sendOtp, verifyOtp } from '@/lib/otp';
import { allow, clientIp } from '@/lib/ratelimit';
import { attachSession } from '@/lib/signin';

const SENT = 'If this email has access, a 6-digit code is on its way (check spam / Promotions). It is valid for 10 minutes.';

// POST {email} → email a code · POST {email, code} → sign in
export async function POST(req: Request) {
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = (b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  const ip = clientIp(req);
  if (!b.code) {
    if (!(await allow('otp-send-ip', ip, 10, 3600)) || !(await allow('otp-send', email, 3, 900))) return NextResponse.json({ error: 'Too many codes requested — wait 15 minutes.' }, { status: 429 });
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300)); // same timing either way
    try { await sendOtp(email); } catch (e) { console.error('otp send failed', (e as Error).message); }
    return NextResponse.json({ ok: true, note: SENT });
  }
  if (!(await allow('otp-try-ip', ip, 30, 900)) || !(await allow('otp-try', email, 10, 900))) return NextResponse.json({ error: 'Too many attempts — wait 15 minutes and request a new code.' }, { status: 429 });
  if (!(await verifyOtp(email, b.code))) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: 'Wrong or expired code. Check the latest email, or request a new code.' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  if (!(await attachSession(res, email))) return NextResponse.json({ error: 'Your access has ended — ask the owner.' }, { status: 403 });
  return res;
}
