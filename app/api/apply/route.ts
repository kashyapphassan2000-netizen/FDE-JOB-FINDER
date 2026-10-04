import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { deleteKit, getApplyProfile, listKits, prepareKit, profileFromCv, saveApplyProfile, updateKit } from '@/lib/apply';
import { spendGuard } from '@/lib/limits';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json({ profile: await getApplyProfile(), kits: await listKits() });
}

// POST {action:'profile', profile} | {action:'profile_from_cv'} | {action:'kit', url, title?, company?} | {action:'status', id, status, note?} | {action:'edit', id, fields, coverLetter} | {action:'delete', id}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as Record<string, any>;
  try {
    if (b.action === 'profile') return Response.json({ profile: await saveApplyProfile(b.profile || {}) });
    if (b.action === 'profile_from_cv') { const lim = await spendGuard(1); if (lim) return lim; return Response.json({ profile: await profileFromCv() }); }
    if (b.action === 'kit') { const lim = await spendGuard(1); if (lim) return lim; return Response.json({ kit: await prepareKit({ url: String(b.url || ''), title: b.title, company: b.company }) }); }
    if (b.action === 'status' && b.id) return Response.json({ kit: await updateKit(b.id, { status: b.status, note: b.note }) });
    if (b.action === 'edit' && b.id) return Response.json({ kit: await updateKit(b.id, { fields: b.fields, coverLetter: b.coverLetter }) });
    if (b.action === 'delete' && b.id) { await deleteKit(b.id); return Response.json({ ok: true }); }
    return bad('unknown action');
  } catch (e) { return bad((e as Error).message, 502); }
}
