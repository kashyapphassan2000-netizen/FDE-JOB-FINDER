import { bindTenant } from '@/lib/auth';
import { spendGuard } from '@/lib/limits';
import { guard, bad } from '@/lib/guard';
import { getReach, reachPlan } from '@/lib/reach';

export const maxDuration = 300;

// GET ?url= → saved plan (or null) · POST {title, company, url, text?, location?, author?, fresh?} → reach-the-decision-maker plan
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const url = new URL(req.url).searchParams.get('url');
  if (!url) return bad('url required');
  return Response.json({ plan: await getReach(url) });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as { title?: string; company?: string; url?: string; text?: string; location?: string; author?: string; fresh?: boolean };
  if (!b.url || !/^https?:\/\//.test(b.url)) return bad('url required');
  if (!b.fresh) { const cached = await getReach(b.url); if (cached) return Response.json({ plan: cached, cached: true }); }
  const lim = await spendGuard(1);
  if (lim) return lim;
  try {
    return Response.json({ plan: await reachPlan({ title: String(b.title || 'this role').slice(0, 200), company: String(b.company || '').slice(0, 120), url: b.url.slice(0, 600), text: String(b.text || '').slice(0, 4000), location: String(b.location || '').slice(0, 120), author: String(b.author || '').slice(0, 120) }) });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
