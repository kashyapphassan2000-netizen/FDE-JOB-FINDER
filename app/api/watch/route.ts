import { guard, bad } from '@/lib/guard';
import { addWatch, listWatch, removeWatch } from '@/lib/watch';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 60;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json(await listWatch());
}

// POST {input, careersUrl?} → add · DELETE {kind, id} → remove
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  await loadVault();
  const b = (await req.json().catch(() => ({}))) as { input?: string; careersUrl?: string };
  try {
    return Response.json(await addWatch(String(b.input || '').slice(0, 300), b.careersUrl?.slice(0, 300)));
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const b = (await req.json().catch(() => ({}))) as { kind?: 'ats' | 'page'; id?: string };
  if (!b.id || (b.kind !== 'ats' && b.kind !== 'page')) return bad('kind and id required');
  await removeWatch(b.kind, b.id);
  return Response.json({ ok: true });
}
