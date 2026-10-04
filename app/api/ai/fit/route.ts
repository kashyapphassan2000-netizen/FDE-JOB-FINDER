import { guard, bad } from '@/lib/guard';
import { fitAnalysis } from '@/lib/agent';
import { hdel } from '@/lib/store';

export const maxDuration = 120;

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { job, refresh } = (await req.json()) as { job: { id: string; title: string; company: string; location: string; url: string; description?: string }; refresh?: boolean };
  if (!job?.id || !job.url) return bad('job required');
  try {
    if (refresh) await hdel('fit', job.id);
    return Response.json(await fitAnalysis(job));
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
