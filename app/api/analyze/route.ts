import { guard, bad } from '@/lib/guard';
import { analyzeJob, deleteAnalysis, getAnalysis, listAnalyses } from '@/lib/analyzer';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const id = new URL(req.url).searchParams.get('id');
  if (id) return Response.json({ analysis: await getAnalysis(id) });
  return Response.json({ list: await listAnalyses() });
}

// POST {url?, text?, company?, role?} → full analysis (1-3 min) · DELETE {id}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const b = (await req.json().catch(() => ({}))) as { url?: string; text?: string; company?: string; role?: string };
  const url = b.url?.trim().slice(0, 600);
  if (url && !/^https?:\/\//i.test(url)) return bad('The link must start with http');
  if (!url && !(b.text || '').trim()) return bad('Paste a job link or the job description');
  try {
    return Response.json({ analysis: await analyzeJob({ url, text: b.text?.slice(0, 15000), company: b.company?.slice(0, 120), role: b.role?.slice(0, 160) }) });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return bad('id required');
  await deleteAnalysis(id);
  return Response.json({ ok: true });
}
