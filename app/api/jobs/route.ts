import { guard } from '@/lib/guard';
import { getHealth, getJobs, getMeta } from '@/lib/refresh';
import { hgetall, storeMode } from '@/lib/store';
import type { TrackEntry } from '@/lib/types';

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const [jobs, meta, track, health] = await Promise.all([getJobs(), getMeta(), hgetall<TrackEntry>('track'), getHealth()]);
  return Response.json({ jobs, meta, track, storeMode, sourcesOk: Object.values(health).filter((h) => h.ok).length });
}
