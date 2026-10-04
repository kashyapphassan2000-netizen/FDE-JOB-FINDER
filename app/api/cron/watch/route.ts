import { isCron, unauthorized } from '@/lib/auth';
import { runWatch } from '@/lib/watch';
import { acquireLock, releaseLock } from '@/lib/store';

export const maxDuration = 300;

// Vercel Cron (~every 2 h): check every watched company and email new AI / FDE roles.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  if (!(await acquireLock('watch:run', 290))) return Response.json({ ok: true, skipped: 'already running' });
  try { return Response.json({ ok: true, ...(await runWatch(250000)) }); } finally { await releaseLock('watch:run'); }
}
