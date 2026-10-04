import { getJSON, hgetall, hincr, setJSON } from './store';
import { isMember, tenant } from './tenant';

/**
 * Fair-use limits so one user can never burn the owner's free AI / search quota.
 * The owner is never limited. Each user gets a daily budget of "AI actions" (one = one analysis, one referral report,
 * one mentor message, one agent run / chat, one agent search …) and a max number of custom agents.
 * Seat caps: how many people can have access at once (permanent + time-limited).
 */
export interface Limits { maxMembers: number; maxTimed: number; actionsPerDay: number; maxAgents: number; minScheduleHours: number }
export const DEFAULT_LIMITS: Limits = { maxMembers: 15, maxTimed: 10, actionsPerDay: 25, maxAgents: 3, minScheduleHours: 6 };
export type MemberLimits = Partial<Pick<Limits, 'actionsPerDay' | 'maxAgents'>>;

export async function getLimits(): Promise<Limits> { return { ...DEFAULT_LIMITS, ...(await getJSON<Partial<Limits>>('auth:limits', {})) }; }
export async function saveLimits(p: Partial<Limits>): Promise<Limits> {
  const cur = await getLimits();
  const n = (v: unknown, fb: number, lo: number, hi: number) => (v === undefined || v === null || v === '' ? fb : Math.max(lo, Math.min(hi, Math.round(Number(v)) || lo)));
  const next: Limits = { maxMembers: n(p.maxMembers, cur.maxMembers, 0, 500), maxTimed: n(p.maxTimed, cur.maxTimed, 0, 500), actionsPerDay: n(p.actionsPerDay, cur.actionsPerDay, 0, 1000), maxAgents: n(p.maxAgents, cur.maxAgents, 0, 50), minScheduleHours: n(p.minScheduleHours, cur.minScheduleHours, 1, 168) };
  await setJSON('auth:limits', next);
  return next;
}
async function memberOverride(ns: string): Promise<MemberLimits> {
  const m = (await hgetall<{ limits?: MemberLimits }>('auth:members'))[ns];
  return m?.limits || {};
}
export async function limitsFor(ns: string): Promise<{ actionsPerDay: number; maxAgents: number; minScheduleHours: number }> {
  const [g, o] = await Promise.all([getLimits(), memberOverride(ns)]);
  return { actionsPerDay: o.actionsPerDay ?? g.actionsPerDay, maxAgents: o.maxAgents ?? g.maxAgents, minScheduleHours: g.minScheduleHours };
}

// India day (resets at midnight IST)
const day = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
export async function usedToday(ns: string): Promise<number> { return Number((await hgetall<number>(`quota:${day()}`))[ns] || 0); }
export async function usageToday(): Promise<Record<string, number>> { return hgetall<number>(`quota:${day()}`); }
export async function canSpend(ns: string): Promise<boolean> { if (ns === 'owner') return true; return (await usedToday(ns)) < (await limitsFor(ns)).actionsPerDay; }

export class LimitError extends Error {}
/** Count one AI action for a user; throws LimitError when today's budget is used up. */
export async function spend(ns: string, n = 1): Promise<number> {
  if (ns === 'owner') return 0;
  const lim = (await limitsFor(ns)).actionsPerDay;
  const used = await hincr(`quota:${day()}`, ns, n);
  if (used > lim) { await hincr(`quota:${day()}`, ns, -n); throw new LimitError(`Daily limit reached (${lim} AI actions/day). It resets at midnight IST — or ask the owner for a higher limit.`); }
  return used;
}
/** For route handlers: null = go ahead; a 429 response when the signed-in user is out of today's budget. */
export async function spendGuard(n = 1): Promise<Response | null> {
  if (!isMember()) return null;
  try { await spend(tenant().ns, n); return null; } catch (e) { return Response.json({ error: (e as Error).message, limit: true }, { status: 429 }); }
}
