import type { Job } from './types';
import { secret } from './secrets';
import { hincr } from './store';

/** Telegram bot alerts (free). Optional Discord/Slack-compatible webhook too. */
export function notifyConfigured() {
  return {
    telegram: Boolean(secret('TELEGRAM_BOT_TOKEN') && secret('TELEGRAM_CHAT_ID')),
    webhook: Boolean(secret('ALERT_WEBHOOK_URL')),
    email: Boolean(secret('RESEND_API_KEY') && secret('DIGEST_TO')) && process.env.EMAIL_ALERTS !== 'off',
  };
}

const esc = (s: string) => (s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);

export async function sendAlert(jobs: Job[], header = 'New matching jobs'): Promise<{ sent: number; error?: string }> {
  if (!jobs.length) return { sent: 0 };
  const top = jobs.slice(0, 15);
  const errors: string[] = [];
  const { telegram, webhook, email } = notifyConfigured();
  if (telegram) {
    const lines = top.map(
      (j) => `• <b>${esc(j.title)}</b> — ${esc(j.company)}\n  ${esc(j.location || '')} · ${j.categories.join('/')} · score ${j.score}\n  <a href="${esc(j.url)}">open</a>`,
    );
    const text = `🔔 <b>${esc(header)}</b> (${jobs.length})\n\n${lines.join('\n\n')}`.slice(0, 4000);
    try {
      const r = await fetch(`https://api.telegram.org/bot${secret('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: secret('TELEGRAM_CHAT_ID'), text, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      if (!r.ok) errors.push(`Telegram ${r.status}: ${(await r.text()).slice(0, 120)}`);
    } catch (e) {
      errors.push(`Telegram: ${(e as Error).message}`);
    }
  }
  if (webhook) {
    const content = `**${header}** (${jobs.length})\n` + top.map((j) => `• ${j.title} — ${j.company} (${j.location}) <${j.url}>`).join('\n');
    try {
      const r = await fetch(secret('ALERT_WEBHOOK_URL'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, 1900), text: content.slice(0, 3000) }),
      });
      if (!r.ok) errors.push(`Webhook ${r.status}`);
    } catch (e) {
      errors.push(`Webhook: ${(e as Error).message}`);
    }
  }
  if (email) {
    const n = await hincr('alerts:email', new Date().toISOString().slice(0, 10)).catch(() => 0);
    if (n <= 40) {
      const rows = top.map((j) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb"><a href="${esc(j.url)}" style="font-weight:600;color:#4f46e5;text-decoration:none">${esc(j.title)}</a><div style="color:#4b5563;font-size:13px">${esc(j.company)} · ${esc(j.location || 'location not stated')}${j.salary ? ` · ${esc(j.salary)}` : ''}</div>${j.description && /📣/.test(j.title) ? `<div style="font-size:12.5px;color:#374151;margin-top:4px;white-space:pre-wrap">${esc(j.description.slice(0, 400))}</div>` : ''}</td></tr>`).join('');
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: secret('DIGEST_FROM') || 'FDE Job Finder <onboarding@resend.dev>',
            to: secret('DIGEST_TO').split(/[,;\s]+/).filter(Boolean),
            subject: `🔔 ${header} (${jobs.length})`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:auto"><h3 style="margin-bottom:4px">${esc(header)} (${jobs.length})</h3><div style="color:#6b7280;font-size:12.5px">Apply early: most interviews go to the first 24–72 h of applicants.</div><table style="width:100%;border-collapse:collapse">${rows}</table></div>`,
          }),
        });
        if (!r.ok) errors.push(`Email ${r.status}: ${(await r.text()).slice(0, 120)}`);
      } catch (e) {
        errors.push(`Email: ${(e as Error).message}`);
      }
    }
  }
  return { sent: telegram || webhook || email ? top.length : 0, error: errors.join('; ') || undefined };
}
