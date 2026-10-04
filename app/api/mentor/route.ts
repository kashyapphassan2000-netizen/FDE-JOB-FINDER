import { currentUser, unauthorized } from '@/lib/auth';
import { bad } from '@/lib/guard';
import { applyGraphOps, dailyBrief, forget, getGraph, mentorChat, mentorState, nsOf, saveGraph, saveMProfile, touchSpace, type Graph, type GraphOps } from '@/lib/mentor';

export const maxDuration = 300;

// Everything here is PRIVATE to the signed-in person: their own profile, chat, memory, briefs and knowledge graph.
export async function GET(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  const ns = nsOf(u.email);
  return Response.json({ ...(await mentorState(ns)), you: u.email });
}

// POST {action:'chat',text} | {action:'profile',...} | {action:'brief',force?} | {action:'graph-ops',ops} | {action:'graph-save',graph} | {action:'forget',what}
export async function POST(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  const ns = nsOf(u.email);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown> & { action?: string };
  try {
    await touchSpace(ns);
    if (b.action === 'chat') { const text = String(b.text || '').trim().slice(0, 4000); if (!text) return bad('Say something'); return Response.json(await mentorChat(ns, text)); }
    if (b.action === 'profile') return Response.json({ profile: await saveMProfile(ns, b as never) });
    if (b.action === 'brief') return Response.json({ brief: await dailyBrief(ns, Boolean(b.force)) });
    if (b.action === 'graph-ops') { const n = await applyGraphOps(ns, b.ops as GraphOps); return Response.json({ changes: n, graph: await getGraph(ns) }); }
    if (b.action === 'graph-save') return Response.json({ graph: await saveGraph(ns, b.graph as Graph) });
    if (b.action === 'forget') { await forget(ns, (b.what as 'chat') || 'chat'); return Response.json({ ok: true }); }
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
