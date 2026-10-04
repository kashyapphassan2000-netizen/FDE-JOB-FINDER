import { guard, bad } from '@/lib/guard';
import { buildMarketReport, computeTrends, type MarketReport } from '@/lib/trends';
import { getJSON } from '@/lib/store';

export const maxDuration = 180;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const [trends, report] = await Promise.all([computeTrends(), getJSON<MarketReport | null>('trends:report', null)]);
  return Response.json({ trends, report });
}

// POST → rebuild the AI market report from fresh searches
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  try {
    return Response.json({ report: await buildMarketReport() });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
