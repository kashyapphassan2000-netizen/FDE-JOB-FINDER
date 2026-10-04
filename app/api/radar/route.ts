import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { radarState, runFormD, runGithubRadar, setOrgs, TARGET_DEPS } from '@/lib/radar';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

// Zero-day radar (shared market signal): everyone reads; only the owner runs / edits it (proxy enforces).
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json({ ...(await radarState()), deps: Object.keys(TARGET_DEPS) });
}

// POST {action:'run'} | {action:'orgs', orgs:[...]}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as { action?: string; orgs?: string[] };
  try {
    if (b.action === 'orgs') { await setOrgs(b.orgs || []); return Response.json(await radarState()); }
    if (b.action === 'run') { const [gh, fd] = await Promise.allSettled([runGithubRadar(150000), runFormD(150000)]); return Response.json({ github: gh.status === 'fulfilled' ? gh.value : { error: (gh.reason as Error).message }, formd: fd.status === 'fulfilled' ? fd.value : { error: (fd.reason as Error).message } }); }
    return bad('unknown action');
  } catch (e) { return bad((e as Error).message, 502); }
}
