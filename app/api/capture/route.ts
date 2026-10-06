import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { processCapture, type CapturePayload } from '@/lib/capture';
import { loadVault } from '@/lib/secrets';
import { ingestPosts, type CapturedPost } from '@/lib/postwatch';

export const maxDuration = 300;

// Called by the /capture page (same origin, your session) with the page the bookmarklet sent.
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const p = (await req.json().catch(() => null)) as (CapturePayload & { p?: CapturedPost[] }) | null;
  if (!p?.u || !p?.x) return bad('empty capture');
  // X / LinkedIn feeds: the bookmarklet read each post exactly (link, time, author, text) → the hiring post radar
  if (p.p?.length) {
    try {
      const r = await ingestPosts(p.p);
      return Response.json({ host: new URL(p.u).hostname.replace(/^www\./, ''), jobs: 0, posts: r.added, added: r.added, radar: { got: r.got, dropped: r.dropped, pending: r.pending, emailed: r.emailed }, items: r.items.map((x) => ({ kind: 'post', title: x.ai?.role || x.roles.join(', '), company: x.ai?.company || x.author, location: x.ai?.location || x.place, url: x.url })) });
    } catch (e) { return bad((e as Error).message, 502); }
  }
  try {
    return Response.json(await processCapture(p));
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
