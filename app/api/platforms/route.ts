import platforms from '@/data/platforms.json';
import { guard, bad } from '@/lib/guard';
import { getJSON, hgetall, hset } from '@/lib/store';
import { SOURCES, sourceConfigured } from '@/lib/sources';
import { coverage } from '@/lib/coverage';
import { getHealth } from '@/lib/refresh';
import { getSettings } from '@/lib/settings';
import { loadVault } from '@/lib/secrets';

type Check = { lastChecked?: string; status?: string; notes?: string };

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  await loadVault();
  const [checks, health, settings, disc] = await Promise.all([hgetall<Check>('pchk'), getHealth(), getSettings(), getJSON<{ at: string } | null>('disc:meta', null)]);
  const live = Object.fromEntries(SOURCES.map((s) => [s.id, sourceConfigured(s)]));
  const eff = Object.fromEntries(coverage(health, settings.extraCompanies, Boolean(disc && Date.now() - Date.parse(disc.at) < 3 * 864e5)).map((c) => [c.id, c]));
  return Response.json({ platforms, checks, live, eff });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { id, status, notes } = (await req.json()) as { id: string; status?: string; notes?: string };
  if (!(platforms as { id: string }[]).some((p) => p.id === id)) return bad('unknown platform');
  const cur = (await hgetall<Check>('pchk'))[id] || {};
  const next: Check = { ...cur, lastChecked: status === 'checked' || status === 'done' ? new Date().toISOString() : cur.lastChecked, status: status ?? cur.status, notes: notes ?? cur.notes };
  await hset('pchk', id, next);
  return Response.json({ ok: true, check: next });
}
