import { expire, hincr } from './store';

/** Fixed-window counter: true while `id` has used fewer than `max` hits in the current window. */
export async function allow(name: string, id: string, max: number, windowSec: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${name}:${bucket}`;
  const n = await hincr(key, id.slice(0, 120), 1);
  if (n === 1) await expire(key, windowSec + 60).catch(() => null);
  return n <= max;
}
export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim();
