import { isCron, unauthorized } from '@/lib/auth';
import { runDueSubs } from '@/lib/subscribers';
import { loadVault } from '@/lib/secrets';

export const maxDuration = 300;

// Vercel Cron (daily, twice for overflow): job-link emails for everyone added in "Job alerts for others".
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  await loadVault();
  return Response.json({ ok: true, ...(await runDueSubs(250000)) });
}
