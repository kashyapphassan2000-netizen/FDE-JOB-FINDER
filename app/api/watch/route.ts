import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { addWatch, bulkAdd, listWatch, removeWatch, runWatch, setLocations } from '@/lib/watch';
import { acquireLock, releaseLock } from '@/lib/store';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  return Response.json(await listWatch());
}

// POST {action:'add', input, careersUrl?, locations?} | {action:'bulk', text, locations?} | {action:'locations', id, locations} | {action:'check'}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as { action?: string; input?: string; careersUrl?: string; text?: string; id?: string; locations?: string[] };
  const locs = (b.locations || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
  try {
    if (b.action === 'bulk') return Response.json({ results: await bulkAdd(String(b.text || '').slice(0, 20000), locs) });
    if (b.action === 'locations' && b.id) { await setLocations(b.id, locs); return Response.json({ ok: true }); }
    if (b.action === 'check') {
      if (!(await acquireLock('watch:run', 290))) return bad('A check is already running — reload in a minute', 409);
      try { return Response.json(await runWatch(250000)); } finally { await releaseLock('watch:run'); }
    }
    const e = await addWatch(String(b.input || '').slice(0, 300), b.careersUrl?.slice(0, 300), locs);
    return Response.json({ entry: e, note: e.note });
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as { id?: string };
  if (!b.id) return bad('id required');
  await removeWatch(b.id);
  return Response.json({ ok: true });
}
