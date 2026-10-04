import { isCron, unauthorized } from '@/lib/auth';
import { runDiscover } from '@/lib/discover';
import { getOpportunities } from '@/lib/opportunities';

export const maxDuration = 300;

// Vercel Cron (daily): hidden companies / newly funded startups + hackathons & contracts.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  await getOpportunities(true).catch(() => null);
  // Hiring radar, Layoffs and the Trends report have their own daily crons (/api/cron/intel)
  const r = await runDiscover(200000).catch((e) => ({ error: (e as Error).message }));
  return Response.json({ ok: true, task: 'discover', result: r });
}
