import { guard, bad } from '@/lib/guard';
import { getDiscovered, runDiscover, setDiscoveredStatus } from '@/lib/discover';
import { getJSON } from '@/lib/store';
import { getSettings, saveSettings } from '@/lib/settings';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json({ companies: await getDiscovered(), meta: await getJSON('disc:meta', null) });
}

// { action: 'run' } | { action: 'watch' | 'dismiss' | 'new', key }
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { action, key } = (await req.json()) as { action: string; key?: string };
  try {
    if (action === 'run') return Response.json(await runDiscover(260000));
    if (!key) return bad('key required');
    const c = await setDiscoveredStatus(key, action === 'watch' ? 'watched' : action === 'dismiss' ? 'dismissed' : 'new');
    if (action === 'watch' && c.ats) {
      const s = await getSettings();
      if (!s.extraCompanies.some((x) => x.ats === c.ats!.ats && x.slug === c.ats!.slug))
        await saveSettings({ extraCompanies: [...s.extraCompanies, { ats: c.ats.ats, slug: c.ats.slug, name: c.name, tag: c.region.includes('INDIA') ? 'india' : undefined }] });
    }
    return Response.json({ ok: true, company: c, note: action === 'watch' && !c.ats ? 'No public ATS board found — open its careers/YC page manually; it stays in your Watched list.' : undefined });
  } catch (e) {
    return bad((e as Error).message);
  }
}
