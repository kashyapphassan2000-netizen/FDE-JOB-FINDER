import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
import { isCron, unauthorized } from '@/lib/auth';
import { runWatch } from '@/lib/watch';
import { members, ownerEmails } from '@/lib/access';
import { runAs, tenantFor } from '@/lib/tenant';
import { hgetall } from '@/lib/store';
import { acquireLock, releaseLock } from '@/lib/store';

export const maxDuration = 300;

// Vercel Cron (~every 2 h): check every watched company and email new AI / FDE roles.
async function handle(req: Request): Promise<Response> {
  if (!isCron(req)) return unauthorized();
  if (!(await acquireLock('watch:run', 290))) return Response.json({ ok: true, skipped: 'already running' });
  try {
    const t0 = Date.now();
    const owner = await runWatch(150000);
    // every user's own watch list too (their alerts go to their own email), sharing the remaining time
    const users = (await members()).filter((m) => m.role !== 'owner' && (!m.expiresAt || Date.parse(m.expiresAt) > Date.now()));
    const out: string[] = [];
    for (const m of users) {
      const left = 280000 - (Date.now() - t0);
      if (left < 30000) { out.push('time budget used — remaining users next run'); break; }
      const t = tenantFor(m.email, ownerEmails());
      const r = await runAs(t, async () => ((await hgetall('watch:list')) && Object.keys(await hgetall('watch:list')).length ? runWatch(Math.min(left - 10000, 60000)) : null)).catch((e) => ({ error: (e as Error).message }));
      if (r) out.push(`${m.email}: ${'error' in r ? r.error : `${r.checked} checked, ${r.newHits} new`}`);
    }
    return Response.json({ ok: true, ...owner, users: out });
  } finally { await releaseLock('watch:run'); }
}

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `watch${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
