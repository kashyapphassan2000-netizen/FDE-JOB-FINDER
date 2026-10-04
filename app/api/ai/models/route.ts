import { guard, bad } from '@/lib/guard';
import { PRESETS, allProfiles, listModels, type Wire } from '@/lib/llm';

// List models for a saved profile ({id}) or for unsaved form values ({preset, baseUrl, wire, apiKey}).
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const b = (await req.json()) as { id?: string; preset?: string; baseUrl?: string; wire?: Wire; apiKey?: string };
  try {
    let p;
    if (b.id) p = (await allProfiles()).find((x) => x.id === b.id);
    else {
      const pr = PRESETS.find((x) => x.id === b.preset);
      p = { wire: b.wire || pr?.wire || 'openai', baseUrl: b.baseUrl || pr?.baseUrl || '', key: b.apiKey || (pr?.keyless ? 'keyless' : '') };
    }
    if (!p || !p.key || !p.baseUrl) return bad('Need base URL and API key');
    return Response.json({ models: await listModels(p) });
  } catch (e) {
    return bad(`Could not list models: ${(e as Error).message}`);
  }
}
