import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { refresh } from '@/lib/refresh';
import { runDigest } from '@/lib/digest';

export const maxDuration = 300;

// Vercel Cron (daily): refresh all sources, then email the top fresh jobs. Skips if already sent < 20 h ago.
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  await refresh({ trigger: 'digest' }).catch((e) => console.error('digest refresh', e));
  try {
    return Response.json({ ok: true, ...(await runDigest()) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `digest${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
