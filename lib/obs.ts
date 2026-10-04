import { randomBytes } from 'node:crypto';
import { delKey, hgetall, hincr, hset, expire } from './store';
import { tenant } from './tenant';

/**
 * OBSERVABILITY — one event stream for everything the app does on its own or for someone:
 * crons, job sources, AI calls (counters per provider/model), emails, WhatsApp, agent runs, MCP tool calls,
 * sign-ins, alerts, semantic ranking, radar. Each event carries the user it ran for (owner sees all, users see theirs).
 */
export type Area = 'cron' | 'source' | 'ai' | 'email' | 'whatsapp' | 'agent' | 'mcp' | 'login' | 'alerts' | 'semantic' | 'radar' | 'autopilot' | 'system';
export interface ObsEvent { id: string; at: string; ns: string; area: Area; name: string; status: 'ok' | 'warn' | 'fail'; detail: string; ms?: number; ref?: string }
const KEY = 'obs:ev';
const MAX = 1500;
let writes = 0;

export async function track(area: Area, name: string, status: ObsEvent['status'], detail = '', ms?: number, ref?: string, nsOverride?: string): Promise<void> {
  try {
    const at = new Date().toISOString();
    const id = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    await hset(KEY, id, { id, at, ns: nsOverride || tenant().ns, area, name: name.slice(0, 120), status, detail: detail.slice(0, 600), ms, ref } satisfies ObsEvent);
    if (++writes % 40 === 0) await prune();
  } catch {}
}
async function prune() {
  const all = await hgetall<ObsEvent>(KEY);
  const ids = Object.keys(all).sort();
  if (ids.length <= MAX) return;
  const keep = ids.slice(-Math.round(MAX * 0.8));
  await delKey(KEY);
  for (let i = 0; i < keep.length; i += 50) await Promise.all(keep.slice(i, i + 50).map((k) => hset(KEY, k, all[k])));
}
export async function events(filter: { ns?: string; area?: string; status?: string; limit?: number } = {}): Promise<ObsEvent[]> {
  return Object.values(await hgetall<ObsEvent>(KEY))
    .filter((e) => (!filter.ns || e.ns === filter.ns) && (!filter.area || e.area === filter.area) && (!filter.status || e.status === filter.status))
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, filter.limit ?? 400);
}

// AI calls are too frequent for one event each → daily counters per provider|model|outcome (+ total ms)
const day = () => new Date().toISOString().slice(0, 10);
export async function countAi(provider: string, model: string, ok: boolean, ms: number) {
  try {
    const k = `obs:ai:${day()}`;
    const f = `${provider}|${model}`;
    const n = await hincr(k, `${f}|${ok ? 'ok' : 'fail'}`, 1);
    await hincr(k, `${f}|ms`, Math.round(ms));
    if (n === 1) await expire(k, 15 * 864e5);
  } catch {}
}
export async function aiUsage(days = 7) {
  const out: { day: string; provider: string; model: string; ok: number; fail: number; avgMs: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const h = await hgetall<number>(`obs:ai:${d}`);
    const rows: Record<string, { ok: number; fail: number; ms: number }> = {};
    for (const [k, v] of Object.entries(h)) {
      const parts = k.split('|');
      const kind = parts.pop()!;
      const f = parts.join('|');
      rows[f] ||= { ok: 0, fail: 0, ms: 0 };
      if (kind === 'ok') rows[f].ok = Number(v); else if (kind === 'fail') rows[f].fail = Number(v); else rows[f].ms = Number(v);
    }
    for (const [f, r] of Object.entries(rows)) { const [provider, model] = f.split('|'); out.push({ day: d, provider, model, ok: r.ok, fail: r.fail, avgMs: r.ok + r.fail ? Math.round(r.ms / (r.ok + r.fail)) : 0 }); }
  }
  return out;
}
