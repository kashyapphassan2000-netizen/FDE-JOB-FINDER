import { isMember } from '@/lib/tenant';
import { addWatch } from '@/lib/watch';
import { atsCareersUrl } from '@/lib/directory';
import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { getSettings, saveSettings } from '@/lib/settings';
import type { CompanyEntry } from '@/lib/types';

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const { ats, slug, name } = (await req.json()) as { ats: CompanyEntry['ats']; slug: string; name?: string };
  if (!ats || !slug) return bad('ats and slug required');
  // users: goes to THEIR watch list (the shared board list is the owner's)
  if (isMember()) { await addWatch(name || slug, atsCareersUrl({ ats, slug })); return Response.json({ ok: true, personal: true }); }
  const s = await getSettings();
  if (!s.extraCompanies.some((x) => x.ats === ats && x.slug === slug)) await saveSettings({ extraCompanies: [...s.extraCompanies, { ats, slug, name: name || slug }] });
  return Response.json({ ok: true });
}
