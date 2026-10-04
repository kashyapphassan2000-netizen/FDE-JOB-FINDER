import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { runDueSubs } from '@/lib/subscribers';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

// Vercel Cron (daily, twice for overflow): job-link emails for everyone added in "Job alerts for others".
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  await loadVault();
  return Response.json({ ok: true, ...(await runDueSubs(250000)) });
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `alerts${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
