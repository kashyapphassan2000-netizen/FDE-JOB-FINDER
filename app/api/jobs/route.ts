import { bindTenant } from '@/lib/auth';
import { guard } from '@/lib/guard';
import { getHealth, getJobs, getMeta } from '@/lib/refresh';
import { getJSON, hgetall, storeMode } from '@/lib/store';
import { getSem, semanticPass } from '@/lib/semantic';
import { spendGuard } from '@/lib/limits';
import type { TrackEntry } from '@/lib/types';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const [jobs, meta, track, health, sem, semMeta, drafts] = await Promise.all([getJobs(), getMeta(), hgetall<TrackEntry>('track'), getHealth(), getSem(), getJSON('sem:meta', null), hgetall('drafts')]);
  const live = new Set(jobs.map((j) => j.id));
  return Response.json({ jobs, meta, track, storeMode, sourcesOk: Object.values(health).filter((h) => h.ok).length, sem: Object.fromEntries(Object.entries(sem).filter(([id]) => live.has(id))), semMeta, drafts: Object.fromEntries(Object.entries(drafts).filter(([id]) => live.has(id))) });
}

// POST {action:'semantic'} → rank every job for ME (embeddings + rerank of my top 50). Counts as 2 AI actions for users.
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const lim = await spendGuard(2);
  if (lim) return lim;
  try { return Response.json(await semanticPass(await getJobs(), { budgetMs: 240000 })); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}
