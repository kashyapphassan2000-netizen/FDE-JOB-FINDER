import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { detectCompany } from '@/lib/sources/ats';

export const maxDuration = 30;

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const { slug, name } = (await req.json()) as { slug?: string; name?: string };
  if (!slug || !/^[A-Za-z0-9._-]{1,80}$/.test(slug)) return bad('slug must be letters/numbers/-/_ (e.g. "anthropic")');
  return Response.json({ matches: await detectCompany(slug, name || slug) });
}
