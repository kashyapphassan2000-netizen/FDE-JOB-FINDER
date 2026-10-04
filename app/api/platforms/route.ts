import platforms from '@/data/platforms.json';
import { guard, bad } from '@/lib/guard';
import { hgetall, hset } from '@/lib/store';
import { SOURCES, sourceConfigured } from '@/lib/sources';

type Check = { lastChecked?: string; status?: string; notes?: string };

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const checks = await hgetall<Check>('pchk');
  const live = Object.fromEntries(SOURCES.map((s) => [s.id, sourceConfigured(s)]));
  return Response.json({ platforms, checks, live });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { id, status, notes } = (await req.json()) as { id: string; status?: string; notes?: string };
  if (!(platforms as { id: string }[]).some((p) => p.id === id)) return bad('unknown platform');
  const cur = (await hgetall<Check>('pchk'))[id] || {};
  const next: Check = { ...cur, lastChecked: status === 'checked' ? new Date().toISOString() : cur.lastChecked, status: status ?? cur.status, notes: notes ?? cur.notes };
  await hset('pchk', id, next);
  return Response.json({ ok: true, check: next });
}
