import { bindTenant } from '@/lib/auth';
import { guard } from '@/lib/guard';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/settings';
import { DEFAULT_COMPANIES } from '@/lib/companies';

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS, defaultCompanies: DEFAULT_COMPANIES });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const patch = await req.json();
  return Response.json({ settings: await saveSettings(patch) });
}
