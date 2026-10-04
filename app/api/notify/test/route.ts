import { loadVault } from '@/lib/secrets';
import { guard, bad } from '@/lib/guard';
import { notifyConfigured, sendAlert } from '@/lib/notify';
import type { Job } from '@/lib/types';

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  await loadVault();
  const c = notifyConfigured();
  if (!c.telegram && !c.webhook) return bad('Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or ALERT_WEBHOOK_URL) on Vercel first.');
  const demo: Job = {
    id: 'test', title: 'Forward Deployed Engineer (test alert)', company: 'FDE Job Finder', location: 'Bengaluru, India', url: 'https://example.com',
    sources: ['test'], categories: ['FDE'], domain: 'IT', seniority: 'mid', hidden: false, locTags: ['BLR'], score: 99, cvMatch: 0, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(),
  };
  return Response.json(await sendAlert([demo], 'Test alert – your notifications work'));
}
