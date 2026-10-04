import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { runDueMission } from '@/lib/agent';

export const maxDuration = 300;

// Vercel Cron: next due AI-agent mission (X / LinkedIn posts every other slot), within the daily search budget.
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  const r = await runDueMission().catch((e) => ({ error: (e as Error).message }));
  return Response.json({ ok: true, task: 'agent', ...('findIds' in r ? { mission: r.mission, total: r.total, new: r.finds } : r) });
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `agent${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
