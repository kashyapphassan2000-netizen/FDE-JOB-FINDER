import { currentUser, unauthorized } from '@/lib/auth';
import { bad } from '@/lib/guard';
import { nsOf } from '@/lib/mentor';
import { agentChat, deleteAgent, deleteSkill, DEPTHS, getAgentChat, getAgentDef, getRuns, listAgents, listSkills, MODES, publicSkill, runAgentDef, saveAgent, saveSkill, TOOLS } from '@/lib/studio';
import { publicProfiles } from '@/lib/llm';
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
  const models = (await publicProfiles()).filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.label, model: p.model, preset: p.preset, local: /localhost|127\.0\.0\.1/.test(p.baseUrl) }));
  return Response.json({ agents: await listAgents(ns), skills: (await listSkills(ns)).map(publicSkill), tools: TOOLS, modes: MODES, depths: DEPTHS, models, hosted: Boolean(process.env.VERCEL), channels: { ...notifyConfigured(), ...mailerStatus() } });
}

// POST {action:'save', agent} | {action:'run', id, task?} | {action:'chat', id, text} | {action:'delete', id} | {action:'skill_save', skill} | {action:'skill_delete', id}
export async function POST(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  await loadVault();
  const ns = nsOf(u.email);
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; agent?: Record<string, unknown>; skill?: Record<string, unknown>; task?: string; text?: string };
  try {
    if (b.action === 'save') return Response.json({ agent: await saveAgent(ns, b.agent as never) });
    if (b.action === 'skill_save') return Response.json({ skill: publicSkill(await saveSkill(ns, b.skill as never)) });
    if (b.action === 'skill_delete' && b.id) { await deleteSkill(ns, b.id); return Response.json({ ok: true }); }
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
