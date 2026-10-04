import { guard, bad } from '@/lib/guard';
import { refresh } from '@/lib/refresh';

export const maxDuration = 300;

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const body = (await req.json().catch(() => ({}))) as { only?: string[]; force?: boolean };
  try {
    const r = await refresh({ only: body.only, force: Boolean(body.force), trigger: body.only ? `manual:${body.only.join(',')}` : 'manual' });
    return Response.json(r);
  } catch (e) {
    return bad((e as Error).message, 409);
  }
}
