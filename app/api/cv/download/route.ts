import { isAuthed } from '@/lib/auth';
import { getCv, streamCv } from '@/lib/cv';

export async function GET(req: Request) {
  // auth checked right next to the private blob read (Vercel's recommended pattern)
  if (!(await isAuthed(req))) return new Response('Unauthorized', { status: 401 });
  const url = new URL(req.url);
  const cv = await getCv();
  const pathname = url.searchParams.get('p') || cv.active;
  const v = cv.versions.find((x) => x.pathname === pathname);
  if (!pathname || !v) return new Response('No CV uploaded yet', { status: 404 });
  const r = await streamCv(pathname);
  if (!r || r.statusCode !== 200 || !r.stream) return new Response('Not found', { status: 404 });
  return new Response(r.stream, {
    headers: {
      'Content-Type': r.blob.contentType || v.contentType,
      'Content-Disposition': `${url.searchParams.get('dl') ? 'attachment' : 'inline'}; filename="${v.name.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
