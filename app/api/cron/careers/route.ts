import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { scanAllBoards } from '@/lib/careersearch';
import { acquireLock, releaseLock } from '@/lib/store';

export const maxDuration = 300;

// Vercel Cron (4× a day): rebuild the Careers-search index from every company board.
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  if (!(await acquireLock('cs:scan', 290))) return Response.json({ ok: true, skipped: 'already running' });
  try { const r = await scanAllBoards(250000); return Response.json({ done: true, boards: r.boards, boardsOk: r.ok, jobs: r.jobs, ms: r.ms, failed: r.failed.slice(0, 10) }); } finally { await releaseLock('cs:scan'); }
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `careers${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
