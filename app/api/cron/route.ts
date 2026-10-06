import { track as cronTrackRaw } from '@/lib/obs';
const cronTracked = (n: string, st: 'ok' | 'fail', d: string, ms: number) => cronTrackRaw('cron', n, st, d, ms);
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
import { getJSON, setJSON } from '@/lib/store';
import { runDigest } from '@/lib/digest';

export const maxDuration = 300;

// Called by Vercel Cron (daily on Hobby) and by GitHub Actions. All send: Authorization: Bearer <CRON_SECRET>
//   /api/cron                → refresh all job sources (every 30 min)
//   /api/cron?task=agent     → run the next due AI-agent mission (every 3 h by default)
//   /api/cron?task=discover  → hidden companies / new startups scan (daily)
//   /api/cron?task=digest    → refresh, then email the top fresh jobs (daily, skips if sent < 20 h ago)
async function handle(req: Request): Promise<Response> {
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
    if (task === 'health') {
      // daily: if anything critical is down, the important inbox hears about it (once per day per failure set)
      after(() => runAs(OWNER, async () => {
        const { runHealthCheck } = await import('@/lib/health');
        const { sendImportant, esc } = await import('@/lib/mailer');
        const r = await runHealthCheck();
        const bad = r.checks.filter((c) => c.status === 'fail');
        const sig = bad.map((c) => c.name).sort().join('|');
        if (!bad.length || (await getJSON<string>('health:alerted', '')) === `${new Date().toISOString().slice(0, 10)}:${sig}`) return;
        await sendImportant(`${bad.length} service${bad.length > 1 ? 's' : ''} failing in FDE Job Finder`, `<div style="font-family:system-ui"><ul>${bad.map((c) => `<li><b>${esc(c.name)}</b> — ${esc(c.detail || '')}${c.fix ? `<br><span style="color:#555">Fix: ${esc(c.fix)}</span>` : ''}</li>`).join('')}</ul><p style="color:#888;font-size:12px">Full report: Setup → Observability → Run health check.</p></div>`);
        await setJSON('health:alerted', `${new Date().toISOString().slice(0, 10)}:${sig}`);
      }));
      return Response.json({ ok: true, task, started: true });
    }
    if (task === 'postwatch') {
      // hourly: every user's hiring-post radar (X + LinkedIn), batched emails at 100 posts
      const { runAllRadars } = await import('@/lib/postwatch');
      return Response.json({ ok: true, task, ...(await runAs(OWNER, () => runAllRadars(270000))) });
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

// observability: every scheduled run is logged (Observability page)
export async function GET(req: Request) {
  const t0 = Date.now();
  const task = `main${new URL(req.url).searchParams.get('task') ? `:${new URL(req.url).searchParams.get('task')}` : ''}`;
  try {
    const r = await handle(req);
    if (r.status !== 401) await cronTracked(task, r.ok ? 'ok' : 'fail', (await r.clone().text()).slice(0, 500), Date.now() - t0);
    return r;
  } catch (e) {
    await cronTracked(task, 'fail', (e as Error).message, Date.now() - t0);
    throw e;
  }
}
