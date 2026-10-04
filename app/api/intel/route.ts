import { guard, bad } from '@/lib/guard';
import { getIntel, scanIntel } from '@/lib/intel';
import { acquireLock, releaseLock } from '@/lib/store';

export const maxDuration = 300;

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
  if (!(await acquireLock(`intel:${kind}`, 280))) return bad('A fresh scan is already running — reload in a minute', 409);
  try {
    return Response.json(await scanIntel(kind));
  } catch (e) {
    return bad((e as Error).message, 502);
  } finally {
    await releaseLock(`intel:${kind}`);
  }
}
