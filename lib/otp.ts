import { randomInt } from 'node:crypto';
import { hmac, safeEqual } from './auth';
import { hdel, hgetall, hset } from './store';
import { roleOf } from './access';
import { sendMail, mailerStatus } from './mailer';
import { decrypt, encrypt, secret } from './secrets';
import { track } from './obs';

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
  try {
    await sendMail(e, `${code} is your sign-in code`, html);
    await track('login', 'otp sent', 'ok', e);
  } catch (err) {
    // email cannot reach this person (no Gmail / Brevo set up) → the OWNER gets the code to pass on (WhatsApp / own email / Access panel)
    await track('login', 'otp email failed → relayed to owner', 'warn', `${e}: ${(err as Error).message.slice(0, 120)}`);
    await relayToOwner(e, code);
  }
}

/** Pending codes the owner can read in Access (encrypted at rest, 10 minutes). */
export async function relayToOwner(email: string, code: string) {
  await hset('auth:relay', email, { c: encrypt(code), exp: Date.now() + TTL });
  const msg = `🔐 ${email} is trying to sign in to FDE Job Finder. Their code: ${code} (valid 10 min). Send it to them only if you expect this.`;
  const owner = secret('DIGEST_TO');
  const done: string[] = [];
  if (owner && owner !== email) await sendMail(owner, `Sign-in code for ${email}: ${code}`, `<p style="font-family:system-ui">${msg}</p><p style="color:#888;font-size:12px">Your users get this automatically once Gmail (app password) or Brevo is set up in AI &amp; Keys.</p>`).then(() => done.push('owner email')).catch(() => null);
  const { notifyConfigured, sendWhatsApp } = await import('./notify');
  if (notifyConfigured().whatsapp) await sendWhatsApp(msg).then(() => done.push('owner WhatsApp')).catch(() => null);
  await track('login', 'code relayed', done.length ? 'ok' : 'warn', `${email} → ${done.join(', ') || 'Access panel only'}`);
}
export async function pendingRelays(): Promise<{ email: string; code: string; minutesLeft: number }[]> {
  const all = await hgetall<{ c: string; exp: number }>('auth:relay');
  const out: { email: string; code: string; minutesLeft: number }[] = [];
  for (const [email, v] of Object.entries(all)) {
    if (v.exp < Date.now()) { await hdel('auth:relay', email); continue; }
    const c = decrypt(v.c);
    if (c) out.push({ email, code: c, minutesLeft: Math.ceil((v.exp - Date.now()) / 60000) });
  }
  return out;
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
  await hdel('auth:relay', e);
  return Boolean(await roleOf(e));
}

export const otpAvailable = () => mailerStatus().canEmailAnyone;
