import { guard, bad } from '@/lib/guard';
import { hdel, hgetall, hset } from '@/lib/store';
import type { Job, TrackEntry, TrackStatus } from '@/lib/types';

const STATUSES: TrackStatus[] = ['saved', 'applied', 'referral', 'interview', 'offer', 'rejected', 'ignored'];

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json(await hgetall<TrackEntry>('track'));
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { job, status, notes } = (await req.json()) as { job: Job; status: TrackStatus | 'none'; notes?: string };
  if (!job?.id) return bad('job required');
  if (status === 'none') {
    await hdel('track', job.id);
    return Response.json({ ok: true });
  }
  if (!STATUSES.includes(status)) return bad('bad status');
  const entry: TrackEntry = {
    status,
    notes: (notes || '').slice(0, 2000),
    updatedAt: new Date().toISOString(),
    job: { id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, sources: job.sources, categories: job.categories, postedAt: job.postedAt },
  };
  await hset('track', job.id, entry);
  return Response.json({ ok: true, entry });
}
