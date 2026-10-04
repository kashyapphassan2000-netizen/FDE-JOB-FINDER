import workbook from '@/data/workbook.json';
import { guard, bad } from '@/lib/guard';
import { hgetall, hset } from '@/lib/store';

type RowTrack = { status: 'todo' | 'doing' | 'done' | 'skip'; notes?: string; updatedAt: string };

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json({ workbook, track: await hgetall<RowTrack>('xl') });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { key, status, notes } = (await req.json()) as { key: string; status: RowTrack['status']; notes?: string };
  if (!key || !/^[^:]{1,60}:\d{1,5}$/.test(key)) return bad('bad key');
  if (!['todo', 'doing', 'done', 'skip'].includes(status)) return bad('bad status');
  const entry: RowTrack = { status, notes: (notes || '').slice(0, 2000), updatedAt: new Date().toISOString() };
  await hset('xl', key, entry);
  return Response.json({ ok: true, entry });
}
