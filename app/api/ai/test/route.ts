import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { chat } from '@/lib/llm';

export const maxDuration = 60;

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  try {
    const t0 = Date.now();
    const r = await chat('You are a test endpoint.', 'Reply with exactly: OK FDE', { maxTokens: 200, timeoutMs: 45000, profileId: id });
    return Response.json({ ok: true, reply: r.text.slice(0, 100), provider: r.provider, model: r.model, ms: Date.now() - t0, tried: r.tried });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
