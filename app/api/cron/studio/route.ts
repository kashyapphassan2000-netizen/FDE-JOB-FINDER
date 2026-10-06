import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { runDueAgents } from '@/lib/studio';
import { acquireLock, releaseLock } from '@/lib/store';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

// Vercel Cron (every hour): run every custom agent whose schedule is due.
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  if (!(await acquireLock('studio:run', 295))) return Response.json({ ok: true, skipped: 'already running' });
  await loadVault();
  try {
    return Response.json({ ok: true, ...(await runDueAgents(270000)) });
  } finally { await releaseLock('studio:run'); }
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `studio${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
