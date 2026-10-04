import { bindTenant } from '@/lib/auth';
import { guard } from '@/lib/guard';
import { runDigest } from '@/lib/digest';

export const maxDuration = 120;

// GET  → preview today's picks (nothing is sent)
// POST → send the email now (ignores the once-a-day limit)
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json(await runDigest({ dryRun: true }));
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  try {
    return Response.json(await runDigest({ force: true }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
