import { isCron, unauthorized } from '@/lib/auth';
import { refresh } from '@/lib/refresh';
import { runDigest } from '@/lib/digest';

export const maxDuration = 300;

// Vercel Cron (daily): refresh all sources, then email the top fresh jobs. Skips if already sent < 20 h ago.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  await refresh({ trigger: 'digest' }).catch((e) => console.error('digest refresh', e));
  try {
    return Response.json({ ok: true, ...(await runDigest()) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
