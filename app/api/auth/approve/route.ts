import { loadVault } from '@/lib/secrets';
import { approveFromLink } from '@/lib/requests';
import { allow, clientIp } from '@/lib/ratelimit';
import { esc } from '@/lib/mailer';

// One-click approve link from the owner's email (HMAC-signed, expires in 7 days).
export async function GET(req: Request) {
  await loadVault();
  const u = new URL(req.url);
  const page = (msg: string, ok: boolean) => new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;max-width:560px;margin:auto"><h2>${ok ? '✅' : '⚠️'} ${esc(msg)}</h2><p><a href="/">Open FDE Job Finder</a></p></body>`, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (!(await allow('approve-ip', clientIp(req), 20, 3600))) return page('Too many attempts', false);
  try {
    return page(await approveFromLink(String(u.searchParams.get('e') || '').toLowerCase(), Number(u.searchParams.get('h') || 0), Number(u.searchParams.get('x')), String(u.searchParams.get('s') || ''), u.origin), true);
  } catch (e) {
    return page((e as Error).message, false);
  }
}
