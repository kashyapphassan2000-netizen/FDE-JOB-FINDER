import { isCron, unauthorized } from '@/lib/auth';
import { scanIntel } from '@/lib/intel';
import { buildMarketReport } from '@/lib/trends';

export const maxDuration = 300;

// Vercel Cron (daily, one task per call so each fits the time limit): fresh Hiring radar, Layoffs and Trends market report.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  const task = new URL(req.url).searchParams.get('task');
  try {
    if (task === 'hiring' || task === 'layoffs') return Response.json({ ok: true, task, result: await scanIntel(task) });
    if (task === 'report') { const r = await buildMarketReport(); return Response.json({ ok: true, task, headlines: r.headlines.length, articles: r.articles }); }
    return Response.json({ error: 'task must be hiring | layoffs | report' }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, task, error: (e as Error).message }, { status: 500 });
  }
}
