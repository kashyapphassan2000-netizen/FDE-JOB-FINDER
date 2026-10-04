import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { aiUsage, events } from '@/lib/obs';
import { runHealthCheck } from '@/lib/health';
import { getJSON } from '@/lib/store';
import { tenant } from '@/lib/tenant';
import { loadVault, secret } from '@/lib/secrets';
import { sendMail } from '@/lib/mailer';
import { sendWhatsApp } from '@/lib/notify';

export const maxDuration = 300;

// GET ?area=&status= → owner: everything; users: only what ran for them
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const t = tenant();
  const u = new URL(req.url);
  const owner = t.role === 'owner';
  const [ev, ai, health] = await Promise.all([
    events({ ns: owner ? u.searchParams.get('ns') || undefined : t.ns, area: u.searchParams.get('area') || undefined, status: u.searchParams.get('status') || undefined, limit: 500 }),
    owner ? aiUsage(7) : Promise.resolve([]),
    owner ? getJSON('obs:health', null) : Promise.resolve(null),
  ]);
  return Response.json({ owner, events: ev, ai, health });
}

// POST {action:'check'} full service check · {action:'test-email'} · {action:'test-whatsapp'} (owner only — proxy enforces)
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as { action?: string; to?: string };
  try {
    if (b.action === 'check') return Response.json(await runHealthCheck());
    if (b.action === 'test-email') { const to = b.to || secret('DIGEST_TO'); const via = await sendMail(to, 'FDE Job Finder — test email', '<p style="font-family:system-ui">✅ Email works. Sent from the Observability page.</p>'); return Response.json({ ok: true, note: `sent to ${to} via ${via}` }); }
    if (b.action === 'test-whatsapp') { await sendWhatsApp('✅ FDE Job Finder — WhatsApp works (test from Observability).'); return Response.json({ ok: true, note: 'WhatsApp sent' }); }
    return bad('unknown action');
  } catch (e) { return bad((e as Error).message, 502); }
}
