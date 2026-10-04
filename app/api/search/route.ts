import { guard, bad } from '@/lib/guard';
import { universalSearch } from '@/lib/universal';

export const maxDuration = 90;

// GET /api/search?q=mlops+engineer&any=1 — search any role across every source (any=1 ignores your location rule)
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') || '').trim().slice(0, 120);
  if (!q) return bad('q required');
  try {
    return Response.json(await universalSearch(q, { ignoreLocation: u.searchParams.get('any') === '1' }));
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
