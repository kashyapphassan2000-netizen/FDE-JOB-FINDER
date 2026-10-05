import { NextResponse } from 'next/server';
import { loadVault } from '@/lib/secrets';
import { allow, clientIp } from '@/lib/ratelimit';
import { createRequest } from '@/lib/requests';
import { roleOf } from '@/lib/access';

// Public: POST {email, name, role, location, situation} → the owner gets an email with one-click approve links.
export async function POST(req: Request) {
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email' }, { status: 400 });
  if (!(await allow('access-req-ip', clientIp(req), 5, 3600)) || !(await allow('access-req', email, 2, 86400))) return NextResponse.json({ error: 'Request already sent — the owner will reply by email.' }, { status: 429 });
  if (await roleOf(email)) return NextResponse.json({ ok: true, note: 'You already have access — sign in above.' });
  const clip = (k: string, n: number) => String(b[k] || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  await createRequest({ email, name: clip('name', 80), role: clip('role', 120), location: clip('location', 80), situation: clip('situation', 1000) }, new URL(req.url).origin).catch((e) => console.error('access request', (e as Error).message));
  return NextResponse.json({ ok: true, note: 'Request sent to the owner. You will get an email as soon as it is approved.' });
}
