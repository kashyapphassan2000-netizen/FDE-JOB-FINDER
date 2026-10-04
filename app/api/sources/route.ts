import { loadVault } from '@/lib/secrets';
import { guard } from '@/lib/guard';
import { SOURCES, intervalFor, sourceConfigured } from '@/lib/sources';
import { getHealth } from '@/lib/refresh';
import { ping } from '@/lib/store';
import { blobConfigured } from '@/lib/cv';
import { notifyConfigured } from '@/lib/notify';
import { authConfigured } from '@/lib/auth';

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  await loadVault();
  const health = await getHealth();
  const sources = SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    group: s.group,
    keyless: s.keyless,
    envKeys: s.envKeys,
    optionalEnv: s.optionalEnv || [],
    configured: sourceConfigured(s),
    intervalMin: intervalFor(s),
    covers: s.covers,
    docs: s.docs,
    health: health[s.id] || null,
  }));
  const infra = {
    auth: authConfigured(),
    authSecret: Boolean(process.env.AUTH_SECRET),
    cronSecret: Boolean(process.env.CRON_SECRET),
    store: await ping(),
    blob: blobConfigured(),
    notify: notifyConfigured(),
  };
  return Response.json({ sources, infra });
}
