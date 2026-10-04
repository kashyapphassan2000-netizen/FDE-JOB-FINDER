import { guard } from '@/lib/guard';
import { getOpportunities, PROGRAMS } from '@/lib/opportunities';

export const maxDuration = 60;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const force = new URL(req.url).searchParams.get('force') === '1';
  return Response.json({ ...(await getOpportunities(force)), programs: PROGRAMS });
}
