import { bindTenant } from '@/lib/auth';
import { guard } from '@/lib/guard';
import { hgetall } from '@/lib/store';
import type { TrackEntry } from '@/lib/types';

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const t = await hgetall<TrackEntry>('track');
  const rows = [['status', 'title', 'company', 'location', 'categories', 'sources', 'posted', 'updated', 'notes', 'url']];
  for (const e of Object.values(t).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    rows.push([e.status, e.job.title, e.job.company, e.job.location, e.job.categories.join('/'), e.job.sources.join('/'), e.job.postedAt || '', e.updatedAt, e.notes || '', e.job.url]);
  }
  return new Response(rows.map((r) => r.map(csv).join(',')).join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="job-tracker.csv"' },
  });
}
