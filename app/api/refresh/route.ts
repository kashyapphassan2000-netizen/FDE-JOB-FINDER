import { guard, bad } from '@/lib/guard';
import { refresh } from '@/lib/refresh';
import { setJSON } from '@/lib/store';
import { clearSearchCache } from '@/lib/search';

export const maxDuration = 300;

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const body = (await req.json().catch(() => ({}))) as { only?: string[]; force?: boolean; reset?: boolean };
  if (body.reset) {
    // "Clear & refetch": drop the stored list + source cooldowns, then fetch everything fresh (tracker is kept)
    await Promise.all([setJSON('jobs', []), setJSON('health', {}), clearSearchCache()]);
    body.force = true;
  }
  try {
    const r = await refresh({ only: body.only, force: Boolean(body.force), trigger: body.only ? `manual:${body.only.join(',')}` : 'manual' });
    return Response.json(r);
  } catch (e) {
    return bad((e as Error).message, 409);
  }
}
