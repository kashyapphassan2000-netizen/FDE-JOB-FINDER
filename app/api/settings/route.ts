import { guard } from '@/lib/guard';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/settings';
import { DEFAULT_COMPANIES } from '@/lib/companies';

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS, defaultCompanies: DEFAULT_COMPANIES });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const patch = await req.json();
  return Response.json({ settings: await saveSettings(patch) });
}
