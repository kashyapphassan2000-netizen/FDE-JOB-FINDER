/**
 * Background worker — runs every pipeline with NO serverless time limits, from any machine you control
 * (your PC, a ₹0 Oracle/Fly.io/Render free VM, a Raspberry Pi…), writing to the same Upstash Redis as the website.
 *
 *   npm run worker            # loop forever
 *   npm run worker -- once    # one full cycle, then exit (for system cron / GitHub Actions)
 *
 * Needs the same env as the app (.env.local or exported): KV_REST_API_URL/TOKEN (or UPSTASH_*), AUTH_SECRET, AI keys.
 * Uses locks shared with Vercel, so the website's crons and this worker never run the same job twice.
 * Note: it uses your machine's own IP. It does not bypass bot protection — blocked sites stay retired.
 */
import { existsSync, readFileSync } from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const every = (min: number) => min * 60000;
const JOBS: { name: string; everyMs: number; lock: string; run: () => Promise<unknown> }[] = [];
const last: Record<string, number> = {};

async function main() {
  const { runAs, OWNER } = await import('../lib/tenant');
  const { acquireLock, releaseLock, storeMode } = await import('../lib/store');
  const { loadVault } = await import('../lib/secrets');
  const { refresh, getJobs } = await import('../lib/refresh');
  const { semanticPass } = await import('../lib/semantic');
  const { draftOutreach, weeklyGap, emailGap } = await import('../lib/autopilot');
  const { runGithubRadar, runFormD } = await import('../lib/radar');
  const { runDueAgents } = await import('../lib/studio');
  const { runWatch } = await import('../lib/watch');
  const { scanAllBoards } = await import('../lib/careersearch');
  const { runDueMission } = await import('../lib/agent');
  const { secret } = await import('../lib/secrets');
  if (storeMode !== 'redis') console.warn('⚠ No Redis env vars — the worker writes to a local file, the website will not see it.');
  const H = 60;
  JOBS.push(
    { name: 'refresh (all job sources)', everyMs: every(30), lock: 'w:refresh', run: async () => { const r = await refresh({ trigger: 'worker', force: false }); return `${r.added} new / ${r.total} total, failed: ${r.failed.join(',') || 'none'}`; } },
    { name: 'semantic ranking + outreach drafts', everyMs: every(30), lock: 'w:semantic', run: async () => { const s = await semanticPass(await getJobs(), { budgetMs: 15 * 60000 }); const d = await draftOutreach(await getJobs(), 5); return `${s.embedded} embedded, ${s.reranked} reranked, ${d.length} drafts${s.note ? ` (${s.note})` : ''}`; } },
    { name: 'careers boards index', everyMs: every(6 * H), lock: 'cs:scan', run: async () => { const r = await scanAllBoards(20 * 60000); return `${r.ok}/${r.boards} boards, ${r.jobs} roles`; } },
    { name: 'watched companies', everyMs: every(2 * H), lock: 'watch:run', run: async () => { const r = await runWatch(20 * 60000); return `${r.checked} checked, ${r.newHits} new`; } },
    { name: 'agent searches (LinkedIn / X / …)', everyMs: every(3 * H), lock: 'w:mission', run: async () => JSON.stringify(await runDueMission()).slice(0, 160) },
    { name: 'custom agents (Agent studio)', everyMs: every(10), lock: 'studio:run', run: async () => { const r = await runDueAgents(30 * 60000); return `${r.due} due`; } },
    { name: 'zero-day radar', everyMs: every(6 * H), lock: 'w:radar', run: async () => { const [g, f] = await Promise.allSettled([runGithubRadar(10 * 60000), runFormD(5 * 60000)]); return `github ${g.status === 'fulfilled' ? `${g.value.repos} repos, ${g.value.signals.length} signals` : 'failed'} · sec ${f.status === 'fulfilled' ? `${f.value.techy} tech raises` : 'failed'}`; } },
    { name: 'weekly resume gap', everyMs: every(7 * 24 * H), lock: 'w:gap', run: async () => { const r = await weeklyGap(await getJobs(), { readTop: 40 }); if (secret('DIGEST_TO')) await emailGap(r, secret('DIGEST_TO')); return r.gaps.map((g) => g.term).join(', '); } },
  );
  const once = process.argv.includes('once');
  console.log(`worker up · store=${storeMode} · ${once ? 'single cycle' : 'looping'}`);
  for (;;) {
    await loadVault();
    for (const j of JOBS) {
      if (!once && last[j.name] && Date.now() - last[j.name] < j.everyMs) continue;
      if (!(await acquireLock(j.lock, 60 * 60))) { console.log(`· ${j.name}: running elsewhere, skipped`); continue; }
      const t = Date.now();
      try { const r = await runAs(OWNER, j.run); console.log(`✓ ${j.name} (${Math.round((Date.now() - t) / 1000)}s): ${r}`); }
      catch (e) { console.error(`✗ ${j.name}: ${(e as Error).message}`); }
      finally { last[j.name] = Date.now(); await releaseLock(j.lock); }
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, 60000));
  }
  process.exit(0);
}
main();
