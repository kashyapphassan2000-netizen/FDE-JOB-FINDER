import type { Job } from './types';
import { secret } from './secrets';

/** Telegram bot alerts (free). Optional Discord/Slack-compatible webhook too. */
export function notifyConfigured() {
  return {
    telegram: Boolean(secret('TELEGRAM_BOT_TOKEN') && secret('TELEGRAM_CHAT_ID')),
    webhook: Boolean(secret('ALERT_WEBHOOK_URL')),
  };
}

const esc = (s: string) => (s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);

export async function sendAlert(jobs: Job[], header = 'New matching jobs'): Promise<{ sent: number; error?: string }> {
  if (!jobs.length) return { sent: 0 };
  const top = jobs.slice(0, 15);
  const errors: string[] = [];
  const { telegram, webhook } = notifyConfigured();
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
  return { sent: telegram || webhook ? top.length : 0, error: errors.join('; ') || undefined };
}
