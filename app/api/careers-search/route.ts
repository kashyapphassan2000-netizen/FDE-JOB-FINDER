import { isMember } from '@/lib/tenant';
import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { careersSearch } from '@/lib/careersearch';
import { acquireLock, releaseLock } from '@/lib/store';
import type { Profile } from '@/lib/relevance';

export const maxDuration = 300;

// POST {q?, profile?, refresh?} → every company board, ranked by your profile
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as { q?: string; profile?: Partial<Profile>; refresh?: boolean };
  if (isMember()) b.refresh = false; // the shared index is rebuilt by the owner / cron (4×/day)
  const lock = b.refresh ? await acquireLock('cs:scan', 290) : true;
  if (!lock) return bad('A full scan is already running — try again in a minute', 409);
  try {
    return Response.json(await careersSearch({ q: b.q?.slice(0, 120), profile: b.profile, refresh: b.refresh }));
  } catch (e) {
    return bad((e as Error).message, 502);
  } finally {
    if (b.refresh) await releaseLock('cs:scan');
  }
}
