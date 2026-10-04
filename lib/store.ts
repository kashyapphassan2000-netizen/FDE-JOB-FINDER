import { Redis } from '@upstash/redis';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Persistence: Upstash Redis (free tier) via Vercel Marketplace.
 * Accepts both env-var naming schemes Vercel/Upstash inject:
 *   KV_REST_API_URL / KV_REST_API_TOKEN   (Vercel Marketplace "Upstash for Redis")
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (direct Upstash)
 * Falls back to in-memory storage (data resets on cold start) so the app never crashes.
 */
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;

type Mem = Map<string, string>;
const g = globalThis as unknown as { __fjMem?: Mem; __fjHash?: Map<string, Map<string, string>> };
const mem: Mem = (g.__fjMem ||= new Map());
const memHash = (g.__fjHash ||= new Map());

export const storeMode = redis ? 'redis' : 'memory';
const P = 'fj:';

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = redis ? await redis.get<string>(P + key) : mem.get(P + key);
    if (raw === null || raw === undefined) return fallback;
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // large values are gzip-compressed to stay well inside Upstash free bandwidth (10 GB/mo)
    if (str.startsWith('gz:')) return JSON.parse(gunzipSync(Buffer.from(str.slice(3), 'base64')).toString('utf8')) as T;
    return JSON.parse(str) as T;
  } catch (e) {
    console.error('store get failed', key, e);
    return fallback;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  let s = JSON.stringify(value);
  if (s.length > 32_000) s = 'gz:' + gzipSync(Buffer.from(s, 'utf8'), { level: 6 }).toString('base64');
  if (redis) await redis.set(P + key, s);
  else mem.set(P + key, s);
}

export async function hgetall<T>(key: string): Promise<Record<string, T>> {
  try {
    if (redis) {
      // with automaticDeserialization:false Upstash returns the raw flat reply [field, value, field, value…]
      const r = ((await redis.hgetall(P + key)) || {}) as unknown;
      const pairs: [string, unknown][] = Array.isArray(r) ? Array.from({ length: r.length >> 1 }, (_, i) => [String(r[2 * i]), r[2 * i + 1]]) : Object.entries(r as Record<string, unknown>);
      const out: Record<string, T> = {};
      for (const [k, v] of pairs) {
        try {
          out[k] = JSON.parse(typeof v === 'string' ? v : JSON.stringify(v)) as T;
        } catch {
          console.error('store hgetall: bad value', key, k);
        }
      }
      return out;
    }
    const h = memHash.get(P + key) || new Map();
    return Object.fromEntries([...h.entries()].map(([k, v]) => [k, JSON.parse(v) as T]));
  } catch (e) {
    console.error('store hgetall failed', key, e);
    return {};
  }
}

export async function hset(key: string, field: string, value: unknown): Promise<void> {
  const s = JSON.stringify(value);
  if (redis) await redis.hset(P + key, { [field]: s });
  else {
    const h = memHash.get(P + key) || new Map();
    h.set(field, s);
    memHash.set(P + key, h);
  }
}

/** Atomic counter inside a hash (safe under parallel calls). */
export async function hincr(key: string, field: string, by = 1): Promise<number> {
  if (redis) return Number(await redis.hincrby(P + key, field, by));
  const h = memHash.get(P + key) || new Map();
  const v = Number(h.get(field) || 0) + by;
  h.set(field, String(v));
  memHash.set(P + key, h);
  return v;
}

export async function hdel(key: string, field: string): Promise<void> {
  if (redis) await redis.hdel(P + key, field);
  else memHash.get(P + key)?.delete(field);
}

/** Simple distributed lock so cron + manual refresh never overlap. */
export async function acquireLock(name: string, ttlSec: number): Promise<boolean> {
  if (redis) {
    const r = await redis.set(P + 'lock:' + name, String(Date.now()), { nx: true, ex: ttlSec });
    return r === 'OK';
  }
  const k = P + 'lock:' + name;
  const v = mem.get(k);
  if (v && Date.now() - Number(v) < ttlSec * 1000) return false;
  mem.set(k, String(Date.now()));
  return true;
}

export async function releaseLock(name: string): Promise<void> {
  if (redis) await redis.del(P + 'lock:' + name);
  else mem.delete(P + 'lock:' + name);
}

export async function ping(): Promise<{ ok: boolean; mode: string; error?: string }> {
  if (!redis) return { ok: false, mode: 'memory', error: 'No Redis env vars – data will not persist between deployments/cold starts.' };
  try {
    await redis.ping();
    return { ok: true, mode: 'redis' };
  } catch (e) {
    return { ok: false, mode: 'redis', error: (e as Error).message };
  }
}
