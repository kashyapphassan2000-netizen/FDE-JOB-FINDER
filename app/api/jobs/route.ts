import { after } from 'next/server';
import { runAs, OWNER } from '@/lib/tenant';
import { bindTenant } from '@/lib/auth';
import { guard } from '@/lib/guard';
import { getHealth, getJobs, getMeta, refresh } from '@/lib/refresh';
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
  // live on demand: if the feed is older than 30 min, refresh it in the background (shared lock → never twice at once)
  const stale = !meta?.lastRefresh || Date.now() - Date.parse(meta.lastRefresh) > 30 * 6e4;
  if (stale) after(() => runAs(OWNER, async () => { await refresh({ trigger: 'auto (page open)' }).catch(() => null); }));
  return Response.json({ refreshing: stale, jobs, meta, track, storeMode, sourcesOk: Object.values(health).filter((h) => h.ok).length, sem: Object.fromEntries(Object.entries(sem).filter(([id]) => live.has(id))), semMeta, drafts: Object.fromEntries(Object.entries(drafts).filter(([id]) => live.has(id))) });
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
