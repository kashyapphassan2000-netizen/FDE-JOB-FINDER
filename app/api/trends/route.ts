import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { buildMarketReport, computeTrends, type MarketReport } from '@/lib/trends';
import { acquireLock, getJSON, releaseLock } from '@/lib/store';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const [trends, report] = await Promise.all([computeTrends(), getJSON<MarketReport | null>('trends:report', null)]);
  return Response.json({ trends, report });
}

// POST → rebuild the AI market report from fresh searches
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  if (!(await acquireLock('trends:report', 280))) return bad('The report is already being rebuilt — reload in a minute', 409);
  try {
    return Response.json({ report: await buildMarketReport() });
  } catch (e) {
    return bad((e as Error).message, 502);
  } finally {
    await releaseLock('trends:report');
  }
}
