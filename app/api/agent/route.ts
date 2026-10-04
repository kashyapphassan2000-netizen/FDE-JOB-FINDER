import { linkedinLive, xLive } from '@/lib/live';
import { bindTenant } from '@/lib/auth';
import { spendGuard } from '@/lib/limits';
import { guard, bad } from '@/lib/guard';
import { fitsMission, RULES, isFreshFind, withRealDate, MISSIONS, runAgent, type AgentRun, type Find } from '@/lib/agent';
import { delKey, getJSON, hdel, hgetall, hset, setJSON } from '@/lib/store';
import { availableEngines, clearSearchCache, searchUsage } from '@/lib/search';
import { boardSearchLinks, xSearchLinks } from '@/lib/xposts';
import { aiConfigured } from '@/lib/llm';
import { loadVault } from '@/lib/secrets';
import { locationAllowed, locationTags } from '@/lib/classify';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  // live platform feeds for the LinkedIn / X tabs (?live=li|x&q=…)
  const live = new URL(req.url).searchParams.get('live');
  if (live) {
    const q = (new URL(req.url).searchParams.get('q') || '').slice(0, 120);
    return Response.json(live === 'x' ? await xLive(q) : await linkedinLive(q));
  }
  const [finds, runs] = await Promise.all([hgetall<Find>('agent:finds'), getJSON<AgentRun[]>('agent:runs', [])]);
  return Response.json({
    missions: MISSIONS.map((m) => ({ ...m, rule: RULES[m.id] ? { label: RULES[m.id].label, kinds: RULES[m.id].kinds } : null })),
    runs: runs.slice(0, 20),
    finds: Object.values(finds)
      .filter(isFreshFind)
      .map(withRealDate)
      .map((f) => ({ ...f, fits: Array.from(new Set([f.mission, ...(f.missions || [])])).filter((m) => fitsMission(f, m)) }))
      .map((f) => ({ ...f, locTags: locationTags({ title: f.title, company: f.company, location: f.location, url: f.url }) }))
      .filter((f) => f.kind !== 'job' || !f.location || locationAllowed(f.locTags, f.location)) // your location rule, applied to older finds too
      .sort((a, b) => b.foundAt.localeCompare(a.foundAt)),
    engines: availableEngines().map((e) => e.id),
    ai: await aiConfigured(),
    usage: await searchUsage(),
    xLinks: xSearchLinks(),
    boardLinks: boardSearchLinks(),
  });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const lim = await spendGuard(2); // per-user daily AI budget (owner unlimited)
  if (lim) return lim;
  const { missionId, prompt, depth } = (await req.json()) as { missionId?: string; prompt?: string; depth?: 'quick' | 'deep' };
  if (!missionId && !prompt?.trim()) return bad('mission or prompt required');
  return Response.json(await runAgent({ missionId, prompt: prompt?.slice(0, 500), budgetMs: 275000, depth: depth || 'deep' }));
}

export async function PATCH(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const { id, status } = (await req.json()) as { id: string; status: Find['status'] | 'delete' };
  const all = await hgetall<Find>('agent:finds');
  if (!all[id]) return bad('unknown find');
  if (status === 'delete') await hdel('agent:finds', id);
  else await hset('agent:finds', id, { ...all[id], status });
  return Response.json({ ok: true });
}

// DELETE {what:"run", id} | {what:"runs"} | {what:"finds", mission?, status?} | {what:"cache"}
export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as { what?: string; id?: string; mission?: string; status?: string };
  if (b.what === 'run' || b.what === 'runs') {
    const runs = await getJSON<AgentRun[]>('agent:runs', []);
    const keep = b.what === 'runs' ? [] : runs.filter((r) => r.id !== b.id);
    await setJSON('agent:runs', keep);
    return Response.json({ ok: true, removed: runs.length - keep.length });
  }
  if (b.what === 'finds') {
    const all = await hgetall<Find>('agent:finds');
    const victims = Object.values(all).filter((f) => (!b.mission || f.mission === b.mission) && (!b.status || f.status === b.status));
    if (victims.length === Object.keys(all).length) await delKey('agent:finds');
    else for (const f of victims) await hdel('agent:finds', f.id);
    return Response.json({ ok: true, removed: victims.length });
  }
  if (b.what === 'cache') {
    await clearSearchCache();
    return Response.json({ ok: true });
  }
  return bad('unknown delete');
}
