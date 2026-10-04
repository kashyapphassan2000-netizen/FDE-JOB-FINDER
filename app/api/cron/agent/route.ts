import { isCron, unauthorized } from '@/lib/auth';
import { runDueMission } from '@/lib/agent';

export const maxDuration = 300;

// Vercel Cron: next due AI-agent mission (X / LinkedIn posts every other slot), within the daily search budget.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  const r = await runDueMission().catch((e) => ({ error: (e as Error).message }));
  return Response.json({ ok: true, task: 'agent', ...('findIds' in r ? { mission: r.mission, total: r.total, new: r.finds } : r) });
}
