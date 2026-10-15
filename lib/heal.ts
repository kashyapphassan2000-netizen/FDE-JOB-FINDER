import { track } from './obs';
import { getJSON, hdel, hgetall, setJSON } from './store';

/**
 * SELF-HEALING — runs from the daily health cron, the GitHub booster (every 6 h) and Observability → "Heal now".
 * Fixes what software can fix on its own and reports the rest honestly:
 *  1. search engines parked for quota / rate limit → re-tested; a working one goes back into rotation
 *  2. AI cooldowns that already expired → cleared (stale entries made the rotation slower)
 *  3. job list stale (> 3 h) or empty → a fresh refresh is started
 *  4. a source failing 3+ runs in a row → its cooldown is reset so the next run retries it with a clean slate
 */
export interface HealReport { at: string; ms: number; fixed: string[]; still: string[] }

export async function selfHeal(budgetMs = 200000): Promise<HealReport> {
  const t0 = Date.now();
  const fixed: string[] = [], still: string[] = [];

  // 1 · search engines
  try {
    const { searchStatus, testEngine } = await import('./search');
    const st = await searchStatus();
    for (const p of st.parked) {
      const r = await testEngine(p.id).catch(() => ({ ok: false, error: 'test failed' } as { ok: boolean; error?: string }));
      if (r.ok) fixed.push(`search: ${p.id} works again → back in rotation`);
      else still.push(`search: ${p.id} still unavailable (${(r.error || p.reason).slice(0, 80)})`);
    }
    if (!st.live.length && !st.parked.length) still.push('search: no web-search engine configured (Unlimited setup)');
  } catch (e) { still.push(`search check failed: ${(e as Error).message.slice(0, 80)}`); }

  // 2 · AI cooldowns
  try {
    const cool = await hgetall<number>('ai:cool');
    const old = Object.entries(cool).filter(([, until]) => Number(until) < Date.now()).map(([k]) => k);
    for (const k of old) await hdel('ai:cool', k);
    if (old.length) fixed.push(`AI: cleared ${old.length} expired model cooldowns`);
    const { chat } = await import('./llm');
    const r = await chat('Health check.', 'Reply with: OK', { maxTokens: 50, timeoutMs: 30000 }).catch((e) => ({ error: (e as Error).message }));
    if ('error' in r) still.push(`AI: every provider failed (${r.error.slice(0, 120)})`);
    else {
      const mine = r.tried.filter((t) => /\[(primary|secondary)\]/.test(t));
      if (mine.length) still.push(`AI: your ${r.tier === 'secondary' ? 'Primary' : 'Primary / Secondary'} is not answering — ${r.provider} (${r.tier}) covered: ${mine[0].slice(0, 110)}`);
    }
  } catch (e) { still.push(`AI check failed: ${(e as Error).message.slice(0, 80)}`); }

  // 4 · sources stuck failing
  try {
    const health = await getJSON<Record<string, { ok: boolean; lastRun: string | null; lastSuccess: string | null; error?: string; skipped?: string; streak?: number }>>('health', {});
    const prev = await getJSON<Record<string, number>>('heal:fails', {});
    const next: Record<string, number> = {};
    let reset = 0;
    for (const [id, h] of Object.entries(health)) {
      if (h.ok || h.skipped) continue;
      next[id] = (prev[id] || 0) + 1;
      if (next[id] >= 3) { h.lastRun = null; reset++; next[id] = 0; still.push(`source ${id}: failing (${(h.error || '').slice(0, 70)}) — retrying with a clean slate`); }
    }
    await setJSON('heal:fails', next);
    if (reset) await setJSON('health', health);
  } catch (e) { still.push(`source check failed: ${(e as Error).message.slice(0, 80)}`); }

  // 3 · stale / empty job list (last, uses the remaining time)
  try {
    const { getMeta, getJobs, refresh } = await import('./refresh');
    const [meta, jobs] = await Promise.all([getMeta(), getJobs()]);
    const age = meta?.lastRefresh ? Date.now() - Date.parse(meta.lastRefresh) : Infinity;
    if ((age > 3 * 36e5 || !jobs.length) && Date.now() - t0 < budgetMs - 100000) {
      const r = await refresh({ trigger: 'self-heal' }).catch((e) => ({ error: (e as Error).message }));
      if ('error' in r) still.push(`jobs: refresh could not run (${r.error.slice(0, 100)})`);
      else fixed.push(`jobs: list was ${jobs.length ? `${Math.round(age / 36e5)} h old` : 'empty'} → refreshed (${r.added} new, ${r.total} total)`);
    }
  } catch (e) { still.push(`jobs check failed: ${(e as Error).message.slice(0, 80)}`); }

  const rep: HealReport = { at: new Date().toISOString(), ms: Date.now() - t0, fixed, still };
  await setJSON('heal:last', rep);
  await track('system', 'self-heal', still.length ? 'warn' : 'ok', [...fixed.map((f) => `✔ ${f}`), ...still.map((s) => `• ${s}`)].join(' | ') || 'all healthy', rep.ms);
  return rep;
}
