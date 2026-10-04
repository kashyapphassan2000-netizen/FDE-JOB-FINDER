import { tenant } from '@/lib/tenant';
import { randomBytes } from 'node:crypto';
import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { hdel, hgetall, hset } from '@/lib/store';

// Private online notepad — each user has their own notes ('notes' is a personal key).
interface Note { id: string; title: string; body: string; pinned: boolean; updatedAt: string; createdAt: string }

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const notes = Object.values(await hgetall<Note>('notes')).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  return Response.json({ notes });
}

// POST {action:'save', note} | {action:'delete', id}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; note?: Partial<Note> };
  if (b.action === 'delete' && b.id) { await hdel('notes', b.id); return Response.json({ ok: true }); }
  if (b.action !== 'save' || !b.note) return bad('unknown action');
  const all = await hgetall<Note>('notes');
  if (!b.note.id && tenant().role === 'member' && Object.keys(all).length >= 500) return bad('500 notes max — delete some first'); // owner: unlimited
  const cur = b.note.id ? all[b.note.id] : undefined;
  const now = new Date().toISOString();
  const body = String(b.note.body ?? cur?.body ?? '').slice(0, 200_000);
  const n: Note = { id: cur?.id || randomBytes(5).toString('hex'), title: String(b.note.title ?? cur?.title ?? '').slice(0, 120) || body.split('\n')[0].slice(0, 60) || 'Untitled', body, pinned: Boolean(b.note.pinned ?? cur?.pinned), createdAt: cur?.createdAt || now, updatedAt: now };
  await hset('notes', n.id, n);
  return Response.json({ note: n });
}
