import { bindTenant, currentUser, unauthorized } from '@/lib/auth';
import { bad } from '@/lib/guard';
import { spendGuard } from '@/lib/limits';
import { deleteSub, listSubs, runSub, saveSub } from '@/lib/subscribers';
import { mailerStatus } from '@/lib/mailer';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;
const MAX_MEMBER_ALERTS = 3;

// Self-serve job alerts for EVERY user: your roles (any field), your place (any city / country / remote), to any email you add.
export async function GET(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  bindTenant(req);
  await loadVault();
  const me = u.email.toLowerCase();
  return Response.json({ subs: (await listSubs()).filter((s) => s.owner === me).map(({ sentIds, ...s }) => ({ ...s, sentTotal: sentIds?.length || 0 })), mailer: mailerStatus(), you: me, max: u.role === 'owner' ? null : MAX_MEMBER_ALERTS });
}

export async function POST(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  bindTenant(req);
  await loadVault();
  const me = u.email.toLowerCase();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown> & { action?: string; id?: string };
  const mine = (await listSubs()).filter((s) => s.owner === me);
  const own = (id?: string) => Boolean(id && mine.some((s) => s.id === id));
  try {
    if (b.action === 'save') {
      if (b.id && !own(b.id)) return bad('Not your alert', 403);
      if (!b.id && u.role !== 'owner' && mine.length >= MAX_MEMBER_ALERTS) return bad(`${MAX_MEMBER_ALERTS} alerts max — edit or delete one`);
      return Response.json({ sub: await saveSub({ ...(b as object), email: String(b.email || me), owner: me } as never) });
    }
    if (!own(b.id)) return bad('Not your alert', 403);
    if (b.action === 'delete') { await deleteSub(b.id!); return Response.json({ ok: true }); }
    if (b.action === 'run' || b.action === 'preview') {
      const lim = await spendGuard(1);
      if (lim) return lim;
      return Response.json(await runSub(b.id!, b.action === 'preview'));
    }
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message);
  }
}
