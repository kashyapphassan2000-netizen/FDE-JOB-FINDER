import { guard, bad } from '@/lib/guard';
import { getIntel, scanIntel } from '@/lib/intel';

export const maxDuration = 240;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json(await getIntel());
}

// POST {kind:"hiring"|"layoffs"} → fresh news scan (≈8-10 searches, AI extraction)
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { kind } = (await req.json().catch(() => ({}))) as { kind?: 'hiring' | 'layoffs' };
  if (kind !== 'hiring' && kind !== 'layoffs') return bad('kind must be hiring or layoffs');
  try {
    return Response.json(await scanIntel(kind));
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
