import { secret } from './secrets';

/**
 * One way to send email from the app: Gmail (app password, delivers to ANY address) first, then Resend.
 * Honest limit: Resend's free test sender only delivers to the Resend account owner's own address —
 * to email other people either set GMAIL_USER + GMAIL_APP_PASSWORD, or verify a domain in Resend (DIGEST_FROM).
 */
export function mailerStatus() {
  const gmail = Boolean(secret('GMAIL_USER') && secret('GMAIL_APP_PASSWORD'));
  const resend = Boolean(secret('RESEND_API_KEY'));
  const resendDomain = Boolean(secret('DIGEST_FROM'));
  return { gmail, resend, resendDomain, canEmailAnyone: gmail || (resend && resendDomain) };
}

export async function sendMail(to: string, subject: string, html: string): Promise<'gmail' | 'resend'> {
  if (secret('GMAIL_USER') && secret('GMAIL_APP_PASSWORD')) {
    const nodemailer = (await import('nodemailer')).default;
    const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: secret('GMAIL_USER'), pass: secret('GMAIL_APP_PASSWORD') } });
    await t.sendMail({ from: `FDE Job Finder <${secret('GMAIL_USER')}>`, to, subject, html });
    return 'gmail';
  }
  if (secret('RESEND_API_KEY')) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: secret('DIGEST_FROM') || 'FDE Job Finder <onboarding@resend.dev>', to: [to], subject, html }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 160)}${secret('DIGEST_FROM') ? '' : ' — Resend test mode only emails your own address; add GMAIL_USER + GMAIL_APP_PASSWORD in AI & Keys to email anyone'}`);
    return 'resend';
  }
  throw new Error('No email sender set up — add GMAIL_USER + GMAIL_APP_PASSWORD (or RESEND_API_KEY) in AI & Keys');
}

export const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
