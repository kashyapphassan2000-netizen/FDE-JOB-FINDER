import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { processCapture, type CapturePayload } from '@/lib/capture';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

// Called by the /capture page (same origin, your session) with the page the bookmarklet sent.
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const p = (await req.json().catch(() => null)) as CapturePayload | null;
  if (!p?.u || !p?.x) return bad('empty capture');
  if (/(^|\.)(x|twitter|linkedin)\.com$/i.test((() => { try { return new URL(p.u).hostname; } catch { return ''; } })())) return bad('X and LinkedIn are not captured — you check them yourself (owner setting).');
  try {
    return Response.json(await processCapture(p));
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
