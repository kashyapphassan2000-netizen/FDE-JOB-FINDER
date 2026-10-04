import { isCron, unauthorized } from '@/lib/auth';
import { runDiscover } from '@/lib/discover';
import { getOpportunities } from '@/lib/opportunities';
import { buildMarketReport, type MarketReport } from '@/lib/trends';
import { getJSON } from '@/lib/store';

export const maxDuration = 300;

// Vercel Cron (daily): hidden companies / newly funded startups + hackathons & contracts.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  await getOpportunities(true).catch(() => null);
  const rep = await getJSON<MarketReport | null>('trends:report', null);
  if (!rep || Date.now() - Date.parse(rep.at) > 3 * 864e5) await buildMarketReport().catch(() => null); // fresh market report every 3 days
  const r = await runDiscover(260000).catch((e) => ({ error: (e as Error).message }));
  return Response.json({ ok: true, task: 'discover', result: r });
}
