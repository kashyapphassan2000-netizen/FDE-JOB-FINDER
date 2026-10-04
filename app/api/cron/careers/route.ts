import { isCron, unauthorized } from '@/lib/auth';
import { scanAllBoards } from '@/lib/careersearch';
import { acquireLock, releaseLock } from '@/lib/store';

export const maxDuration = 300;

// Vercel Cron (4× a day): rebuild the Careers-search index from every company board.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  if (!(await acquireLock('cs:scan', 290))) return Response.json({ ok: true, skipped: 'already running' });
  try { const r = await scanAllBoards(250000); return Response.json({ done: true, boards: r.boards, boardsOk: r.ok, jobs: r.jobs, ms: r.ms, failed: r.failed.slice(0, 10) }); } finally { await releaseLock('cs:scan'); }
}
