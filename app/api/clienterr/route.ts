import { bindTenant } from '@/lib/auth';
import { guard } from '@/lib/guard';
import { track } from '@/lib/obs';

// The browser reports page crashes here → Observability (area "system", red), so they can be fixed instead of guessed.
const seen = new Map<string, number>();
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as { where?: string; message?: string; stack?: string; healed?: boolean };
  const where = String(b.where || 'app').slice(0, 60);
  const msg = String(b.message || 'unknown error').slice(0, 300);
  const sig = `${where}|${msg}`;
  if (Date.now() - (seen.get(sig) || 0) < 10 * 6e4) return Response.json({ ok: true, deduped: true }); // same crash at most once per 10 min per instance
  seen.set(sig, Date.now());
  await track('system', `UI crash: ${where}`, b.healed ? 'warn' : 'fail', `${msg}${b.healed ? ' · auto-recovered' : ''}\n${String(b.stack || '').slice(0, 260)}`);
  return Response.json({ ok: true });
}
