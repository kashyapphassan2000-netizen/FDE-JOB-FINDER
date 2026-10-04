import { after } from 'next/server';
import { isCron, unauthorized } from '@/lib/auth';
import { getJobs, refresh } from '@/lib/refresh';
import { runAs, OWNER } from '@/lib/tenant';
import { semanticPass } from '@/lib/semantic';
import { runFormD, runGithubRadar } from '@/lib/radar';
import { draftOutreach, emailGap, weeklyGap } from '@/lib/autopilot';
import { loadVault, secret } from '@/lib/secrets';
import { runDueMission } from '@/lib/agent';
import { runDiscover } from '@/lib/discover';
import { getJSON } from '@/lib/store';
import { runDigest } from '@/lib/digest';

export const maxDuration = 300;

// Called by Vercel Cron (daily on Hobby) and by GitHub Actions. All send: Authorization: Bearer <CRON_SECRET>
//   /api/cron                → refresh all job sources (every 30 min)
//   /api/cron?task=agent     → run the next due AI-agent mission (every 3 h by default)
//   /api/cron?task=discover  → hidden companies / new startups scan (daily)
//   /api/cron?task=digest    → refresh, then email the top fresh jobs (daily, skips if sent < 20 h ago)
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  await loadVault();
  const task = new URL(req.url).searchParams.get('task') || 'refresh';
  try {
    // agent + discover keep running in the background after we answer (saves GitHub Actions minutes)
    if (task === 'agent') {
      after(() => runAs(OWNER, async () => { await runDueMission().catch((e) => console.error('agent', e)); }));
      return Response.json({ ok: true, task, started: true });
    }
    if (task === 'discover') {
      const meta = await getJSON<{ at: string } | null>('disc:meta', null);
      if (meta && Date.now() - Date.parse(meta.at) < 20 * 36e5) return Response.json({ ok: true, task, skipped: 'ran in the last 20h' });
      after(() => runAs(OWNER, async () => { await runDiscover(270000).catch((e) => console.error('discover', e)); }));
      return Response.json({ ok: true, task, started: true });
    }
    if (task === 'digest') {
      await refresh({ trigger: 'digest' }).catch((e) => console.error('digest refresh', e));
      return Response.json({ ok: true, task, ...(await runDigest()) });
    }
    if (task === 'radar') {
      after(() => runAs(OWNER, async () => { await Promise.allSettled([runGithubRadar(200000), runFormD(150000)]); }));
      return Response.json({ ok: true, task, started: true });
    }
    if (task === 'gap') {
      after(() => runAs(OWNER, async () => { const r = await weeklyGap(await getJobs()); if (secret('DIGEST_TO')) await emailGap(r, secret('DIGEST_TO')); }));
      return Response.json({ ok: true, task, started: true });
    }
    if (task === 'semantic') return Response.json({ ok: true, task, ...(await semanticPass(await getJobs(), { budgetMs: 240000 })) });
    const r = await refresh({ trigger: req.headers.get('user-agent')?.includes('vercel-cron') ? 'vercel-cron' : 'cron' });
    const { health, ...meta } = r;
    // stages 2-3 (embeddings + rerank) for the new jobs, after we answer
    after(() => runAs(OWNER, async () => {
      await semanticPass(await getJobs(), { budgetMs: 180000 }).catch((e) => console.error('semantic', e));
      await draftOutreach(await getJobs(), 5).catch((e) => console.error('drafts', e)); // ≥0.85 roles → outreach drafted + emailed
    }));
    return Response.json({ ok: true, task, ...meta });
  } catch (e) {
    return Response.json({ ok: false, task, error: (e as Error).message }, { status: 409 });
  }
}
