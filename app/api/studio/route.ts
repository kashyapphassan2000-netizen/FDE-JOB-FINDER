import { currentUser, unauthorized } from '@/lib/auth';
import { bad } from '@/lib/guard';
import { nsOf } from '@/lib/mentor';
import { agentChat, deleteAgent, getAgentChat, getAgentDef, getRuns, listAgents, runAgentDef, saveAgent, TOOLS } from '@/lib/studio';
import { notifyConfigured } from '@/lib/notify';
import { mailerStatus } from '@/lib/mailer';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

// Agents are private to whoever created them.
export async function GET(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  await loadVault();
  const ns = nsOf(u.email);
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const a = await getAgentDef(id);
    if (!a || a.owner !== ns) return bad('Not found', 404);
    return Response.json({ agent: a, runs: await getRuns(id), chat: await getAgentChat(id) });
  }
  return Response.json({ agents: await listAgents(ns), tools: TOOLS, channels: { ...notifyConfigured(), ...mailerStatus() } });
}

// POST {action:'save', agent} | {action:'run', id, task?} | {action:'chat', id, text} | {action:'delete', id}
export async function POST(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  await loadVault();
  const ns = nsOf(u.email);
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; agent?: Record<string, unknown>; task?: string; text?: string };
  try {
    if (b.action === 'save') return Response.json({ agent: await saveAgent(ns, b.agent as never) });
    if (b.action === 'delete' && b.id) { await deleteAgent(ns, b.id); return Response.json({ ok: true }); }
    const a = b.id ? await getAgentDef(b.id) : null;
    if (!a || a.owner !== ns) return bad('Agent not found');
    if (b.action === 'run') return Response.json({ run: await runAgentDef(a, 'manual', b.task?.slice(0, 3000)) });
    if (b.action === 'chat') { const t = String(b.text || '').trim(); if (!t) return bad('Say something'); return Response.json(await agentChat(a, t.slice(0, 3000))); }
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
