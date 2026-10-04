import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { scanIntel } from '@/lib/intel';
import { buildMarketReport } from '@/lib/trends';

export const maxDuration = 300;

// Vercel Cron (daily, one task per call so each fits the time limit): fresh Hiring radar, Layoffs and Trends market report.
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  const task = new URL(req.url).searchParams.get('task');
  try {
    if (task === 'hiring' || task === 'layoffs') return Response.json({ ok: true, task, result: await scanIntel(task) });
    if (task === 'report') { const r = await buildMarketReport(); return Response.json({ ok: true, task, headlines: r.headlines.length, articles: r.articles }); }
    return Response.json({ error: 'task must be hiring | layoffs | report' }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, task, error: (e as Error).message }, { status: 500 });
  }
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `intel${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
