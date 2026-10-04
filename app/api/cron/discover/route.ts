import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { runDiscover } from '@/lib/discover';
import { getOpportunities } from '@/lib/opportunities';

export const maxDuration = 300;

// Vercel Cron (daily): hidden companies / newly funded startups + hackathons & contracts.
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  await getOpportunities(true).catch(() => null);
  // Hiring radar, Layoffs and the Trends report have their own daily crons (/api/cron/intel)
  const r = await runDiscover(200000).catch((e) => ({ error: (e as Error).message }));
  return Response.json({ ok: true, task: 'discover', result: r });
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `discover${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
