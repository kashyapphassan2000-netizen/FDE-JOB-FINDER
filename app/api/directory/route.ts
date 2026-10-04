import { guard } from '@/lib/guard';
import { getDirectory } from '@/lib/directory';

export const maxDuration = 60;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const [{ getJSON }, d] = await Promise.all([import('@/lib/store'), getDirectory()]);
  const [meta, disc] = await Promise.all([getJSON<{ lastRefresh?: string } | null>('meta', null), getJSON<{ at: string; log: string[] } | null>('disc:meta', null)]);
  return Response.json({ ...d, jobsRefreshed: meta?.lastRefresh || null, startupsScanned: disc?.at || null, startupLog: disc?.log || [] });
}
