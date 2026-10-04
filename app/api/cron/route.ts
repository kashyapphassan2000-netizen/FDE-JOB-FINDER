import { after } from 'next/server';
import { isCron, unauthorized } from '@/lib/auth';
import { refresh } from '@/lib/refresh';
import { runDueMission } from '@/lib/agent';
import { runDiscover } from '@/lib/discover';
import { getJSON } from '@/lib/store';
import { runDigest } from '@/lib/digest';

export const maxDuration = 300;

// Called by Vercel Cron (daily on Hobby) and by GitHub Actions. All send: Authorization: Bearer <CRON_SECRET>
//   /api/cron                → refresh all job sources (every 30 min)
//   /api/cron?task=agent     → run the next due AI-agent mission (every 3 h by default)
//   /api/cron?task=discover  → hidden companies / new startups scan (daily)
//   /api/cron?task=digest    → refresh, then email the top fresh jobs (daily, skips if sent < 20 h ago)
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  const task = new URL(req.url).searchParams.get('task') || 'refresh';
  try {
    // agent + discover keep running in the background after we answer (saves GitHub Actions minutes)
    if (task === 'agent') {
      after(async () => { await runDueMission().catch((e) => console.error('agent', e)); });
      return Response.json({ ok: true, task, started: true });
    }
    if (task === 'discover') {
      const meta = await getJSON<{ at: string } | null>('disc:meta', null);
      if (meta && Date.now() - Date.parse(meta.at) < 20 * 36e5) return Response.json({ ok: true, task, skipped: 'ran in the last 20h' });
      after(async () => { await runDiscover(270000).catch((e) => console.error('discover', e)); });
      return Response.json({ ok: true, task, started: true });
    }
    if (task === 'digest') {
      await refresh({ trigger: 'digest' }).catch((e) => console.error('digest refresh', e));
      return Response.json({ ok: true, task, ...(await runDigest()) });
    }
    const r = await refresh({ trigger: req.headers.get('user-agent')?.includes('vercel-cron') ? 'vercel-cron' : 'cron' });
    const { health, ...meta } = r;
    return Response.json({ ok: true, task, ...meta });
  } catch (e) {
    return Response.json({ ok: false, task, error: (e as Error).message }, { status: 409 });
  }
}
