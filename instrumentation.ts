/**
 * Localhost 24×7: Vercel Cron does not exist on your own machine, so when the app runs locally (npm run dev / npm start)
 * this starts a small in-process scheduler that runs every due custom agent every 5 minutes.
 * Disable with LOCAL_SCHEDULER=0. Never runs on Vercel (there the hourly cron does it).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL || process.env.LOCAL_SCHEDULER === '0') return;
  const g = globalThis as unknown as { __fjSched?: boolean };
  if (g.__fjSched) return;
  g.__fjSched = true;
  const tick = async () => {
    try {
      const { acquireLock, releaseLock } = await import('./lib/store');
      if (!(await acquireLock('studio:run', 295))) return;
      try {
        const { loadVault } = await import('./lib/secrets');
        const { runDueAgents } = await import('./lib/studio');
        await loadVault();
        const r = await runDueAgents(270000);
        if (r.due) console.log(`[local scheduler] ran ${r.due} due agent(s):`, r.log.join(' | '));
      } finally {
        await releaseLock('studio:run');
      }
    } catch (e) {
      console.error('[local scheduler]', (e as Error).message);
    }
  };
  setTimeout(tick, 20000);
  setInterval(tick, 5 * 60000);
  console.log('[local scheduler] on — custom agents run on their schedules while this app is running');
}
