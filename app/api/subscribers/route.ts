import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { deleteSub, listSubs, runSub, saveSub } from '@/lib/subscribers';
import { mailerStatus } from '@/lib/mailer';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  return Response.json({ subs: (await listSubs()).map(({ sentIds, ...s }) => ({ ...s, sentTotal: sentIds?.length || 0 })), mailer: mailerStatus() });
}

// POST {action:'save', ...subscriber} | {action:'run'|'preview', id} | {action:'delete', id}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown> & { action?: string; id?: string };
  try {
    if (b.action === 'save') return Response.json({ sub: await saveSub(b as never) });
    if (b.action === 'delete' && b.id) { await deleteSub(b.id); return Response.json({ ok: true }); }
    if ((b.action === 'run' || b.action === 'preview') && b.id) return Response.json(await runSub(b.id, b.action === 'preview'));
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message);
  }
}
