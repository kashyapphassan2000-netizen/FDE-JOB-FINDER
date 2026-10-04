import { guard, bad } from '@/lib/guard';
import { MISSIONS, runAgent, type AgentRun, type Find } from '@/lib/agent';
import { getJSON, hdel, hgetall, hset } from '@/lib/store';
import { availableEngines, searchUsage } from '@/lib/search';
import { boardSearchLinks, xSearchLinks } from '@/lib/xposts';
import { aiConfigured } from '@/lib/llm';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  await loadVault();
  const [finds, runs] = await Promise.all([hgetall<Find>('agent:finds'), getJSON<AgentRun[]>('agent:runs', [])]);
  return Response.json({
    missions: MISSIONS,
    runs: runs.slice(0, 20),
    finds: Object.values(finds).sort((a, b) => b.foundAt.localeCompare(a.foundAt)),
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
  const { missionId, prompt, depth } = (await req.json()) as { missionId?: string; prompt?: string; depth?: 'quick' | 'deep' };
  if (!missionId && !prompt?.trim()) return bad('mission or prompt required');
  return Response.json(await runAgent({ missionId, prompt: prompt?.slice(0, 500), budgetMs: 275000, depth: depth || 'deep' }));
}

export async function PATCH(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { id, status } = (await req.json()) as { id: string; status: Find['status'] | 'delete' };
  const all = await hgetall<Find>('agent:finds');
  if (!all[id]) return bad('unknown find');
  if (status === 'delete') await hdel('agent:finds', id);
  else await hset('agent:finds', id, { ...all[id], status });
  return Response.json({ ok: true });
}
