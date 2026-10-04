import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { draftOutreach, weeklyGap, type Draft, type GapReport } from '@/lib/autopilot';
import { getJobs } from '@/lib/refresh';
import { getJSON, hgetall } from '@/lib/store';
import { spendGuard } from '@/lib/limits';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const [drafts, reports] = await Promise.all([hgetall<Draft>('drafts'), getJSON<GapReport[]>('gap:reports', [])]);
  return Response.json({ drafts: Object.values(drafts).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60), reports });
}

// POST {action:'gap'} → this week's CV gap report · {action:'drafts'} → draft outreach for my ≥0.85 roles now
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  const lim = await spendGuard(2);
  if (lim) return lim;
  try {
    if (b.action === 'gap') return Response.json({ report: await weeklyGap(await getJobs()) });
    if (b.action === 'drafts') return Response.json({ drafts: await draftOutreach(await getJobs(), 5) });
    return bad('unknown action');
  } catch (e) { return bad((e as Error).message, 502); }
}
