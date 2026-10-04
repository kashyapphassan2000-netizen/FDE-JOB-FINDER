import { tenantForToken } from '@/lib/mcp';
import { runAs } from '@/lib/tenant';
import { getApplyProfile, kitForUrl, listKits, updateKit } from '@/lib/apply';
import { getCv, streamCv } from '@/lib/cv';
import { loadVault } from '@/lib/secrets';
import { allow, clientIp } from '@/lib/ratelimit';

// Used by the autofill bookmarklet (runs on the ATS page, so CORS + bearer token) and the local apply runner.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

async function auth(req: Request) {
  if (!(await allow('apply-runner', clientIp(req), 120, 60))) return null;
  await loadVault();
  return tenantForToken(req.headers.get('authorization'));
}

// GET ?u=<page url> → {profile, kit} · ?queue=1 → queued kits · ?cv=1 → your CV file
export async function GET(req: Request) {
  const t = await auth(req);
  if (!t) return Response.json({ error: 'Unauthorized — create a token in Agent studio → Connect Claude Code' }, { status: 401, headers: CORS });
  const u = new URL(req.url);
  return runAs(t, async () => {
    if (u.searchParams.get('cv')) {
      const cv = await getCv();
      const v = cv.versions.find((x) => x.pathname === cv.active);
      if (!v) return new Response('No CV uploaded', { status: 404, headers: CORS });
      const r = await streamCv(v.pathname);
      if (!r?.stream) return new Response('Not found', { status: 404, headers: CORS });
      return new Response(r.stream, { headers: { ...CORS, 'Content-Type': v.contentType, 'Content-Disposition': `attachment; filename="${v.name.replace(/"/g, '')}"`, 'Cache-Control': 'no-store' } });
    }
    const profile = await getApplyProfile();
    if (u.searchParams.get('queue')) return Response.json({ profile, kits: (await listKits()).filter((k) => k.status === 'queued') }, { headers: CORS });
    const kit = u.searchParams.get('u') ? await kitForUrl(u.searchParams.get('u')!) : null;
    return Response.json({ profile, kit }, { headers: CORS });
  });
}

// POST {id, status:'applied'|'failed'|'queued', note}
export async function POST(req: Request) {
  const t = await auth(req);
  if (!t) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: 'applied' | 'failed' | 'queued'; note?: string };
  return runAs(t, async () => {
    if (!b.id || !b.status) return Response.json({ error: 'id and status required' }, { status: 400, headers: CORS });
    return Response.json({ kit: await updateKit(b.id, { status: b.status, note: String(b.note || '').slice(0, 300) }) }, { headers: CORS });
  });
}
