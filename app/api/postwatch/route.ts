import { bindTenant, currentUser, unauthorized } from '@/lib/auth';
import { bad } from '@/lib/guard';
import { spendGuard } from '@/lib/limits';
import { hgetall, hdel, getJSON } from '@/lib/store';
import { loadVault } from '@/lib/secrets';
import { emailBatch, getPwConfig, runRadar, savePwConfig, type PwContact, type PwMeta, type PwPost } from '@/lib/postwatch';
import { searchStatus } from '@/lib/search';

export const maxDuration = 300;

// Every user's own hiring-post radar (personal keys): GET state · POST {action:'save'|'scan'|'email'|'delete'|'clear-sent'}
export async function GET(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  bindTenant(req);
  await loadVault();
  const [config, meta, posts, contacts, st] = await Promise.all([getPwConfig(), getJSON<PwMeta>('pw:meta', { cursor: 0, sentTotal: 0, scanned: 0 }), hgetall<PwPost>('pw:posts'), hgetall<PwContact>('pw:contacts'), searchStatus()]);
  const list = Object.values(posts).sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  return Response.json({
    config, meta, pending: list.filter((p) => !p.sent).length, total: list.length,
    posts: list.slice(0, 500), contacts: Object.values(contacts).sort((a, b) => b.foundAt.localeCompare(a.foundAt)).slice(0, 1000),
    free: st.live.includes('searxng'),
    apify: await (async () => { const a = await import('@/lib/apifyposts'); return { on: a.apifyOn(), ...(await a.apifyBudget()), pool: (await a.poolPosts()).length, owner: u.role === 'owner' }; })(),
  });
}

export async function POST(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  bindTenant(req);
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as { action?: string; config?: Record<string, unknown>; id?: string };
  try {
    if (b.action === 'save') return Response.json({ config: await savePwConfig(b.config || {}) });
    if (b.action === 'scan') {
      const lim = await spendGuard(1);
      if (lim) return lim;
      return Response.json(await runRadar({ budgetMs: 200000, maxQueries: u.role === 'owner' ? 20 : 8 }));
    }
    if (b.action === 'live-now') {
      if (u.role !== 'owner') return bad('Only the owner can spend Apify credit', 403);
      const { harvest } = await import('@/lib/apifyposts');
      const c = await getPwConfig();
      const h = await harvest([...c.roles, ...c.keywords], { force: true, places: c.places });
      const r = await runRadar({ budgetMs: 200000, maxQueries: 4 });
      return Response.json({ ...r, log: [`Apify: ${h.note}`, ...r.log] });
    }
    if (b.action === 'email') return Response.json({ note: await emailBatch() });
    if (b.action === 'delete' && b.id) { await hdel('pw:posts', b.id); return Response.json({ ok: true }); }
    if (b.action === 'clear-sent') { for (const p of Object.values(await hgetall<PwPost>('pw:posts'))) if (p.sent) await hdel('pw:posts', p.id); return Response.json({ ok: true }); }
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
