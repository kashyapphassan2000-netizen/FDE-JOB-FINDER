import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { getPriority, lastAnswer, setPriority, type AiPriority } from '@/lib/llm';

// Owner only (proxy): which AI answers first. { primary: {profileId, model?}, secondary: {...} } → then the default rotation.
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json({ priority: await getPriority(), last: await lastAnswer() });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  try {
    const b = (await req.json()) as AiPriority;
    return Response.json({ priority: await setPriority(b), last: await lastAnswer() });
  } catch (e) {
    return bad((e as Error).message);
  }
}
