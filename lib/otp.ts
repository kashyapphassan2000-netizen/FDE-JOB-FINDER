import { randomInt } from 'node:crypto';
import { hmac, safeEqual } from './auth';
import { hdel, hgetall, hset } from './store';
import { roleOf } from './access';
import { sendMail, mailerStatus } from './mailer';

/**
 * Email one-time codes (6 digits) for sign-in.
 * - only the HMAC of the code is stored, valid 10 minutes, single use, max 5 wrong tries then it is burned
 * - same answer whether or not the email has access (nobody can probe who is a user)
 * - rate limits live in the routes (per email + per IP)
 */
const TTL = 10 * 60 * 1000;
const MAX_TRIES = 5;
interface Otp { h: string; exp: number; tries: number }

export async function sendOtp(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!(await roleOf(e))) return; // silently: no access → no email, same reply
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await hset('auth:otp', e, { h: await hmac(`otp.${e}.${code}`), exp: Date.now() + TTL, tries: 0 } satisfies Otp);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px"><h3 style="margin:0 0 8px">Your FDE Job Finder sign-in code</h3><div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#0d1424;color:#00f0a0;padding:14px 18px;border-radius:12px;display:inline-block">${code}</div><p style="color:#555;font-size:13px">Valid for 10 minutes, works once. Never share it — nobody from the app will ever ask for it. If you didn't try to sign in, ignore this email.</p></div>`;
  await sendMail(e, `${code} is your sign-in code`, html);
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const c = (code || '').replace(/\D/g, '');
  const cur = (await hgetall<Otp>('auth:otp'))[e];
  if (!cur || Date.now() > cur.exp || cur.tries >= MAX_TRIES || c.length !== 6) {
    if (cur && (Date.now() > cur.exp || cur.tries >= MAX_TRIES)) await hdel('auth:otp', e);
    return false;
  }
  if (!safeEqual(cur.h, await hmac(`otp.${e}.${c}`))) {
    await hset('auth:otp', e, { ...cur, tries: cur.tries + 1 });
    return false;
  }
  await hdel('auth:otp', e); // single use
  return Boolean(await roleOf(e));
}

export const otpAvailable = () => mailerStatus().canEmailAnyone;
