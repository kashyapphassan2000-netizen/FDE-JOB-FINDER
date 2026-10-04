import { isCron, unauthorized } from '@/lib/auth';
import { runDueAgents } from '@/lib/studio';
import { acquireLock, releaseLock } from '@/lib/store';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

// Vercel Cron (every hour): run every custom agent whose schedule is due.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  if (!(await acquireLock('studio:run', 295))) return Response.json({ ok: true, skipped: 'already running' });
  await loadVault();
  try { return Response.json({ ok: true, ...(await runDueAgents(270000)) }); } finally { await releaseLock('studio:run'); }
}
