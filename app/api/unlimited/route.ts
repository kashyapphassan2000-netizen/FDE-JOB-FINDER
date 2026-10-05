import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { CATALOG, unlimitedStatus } from '@/lib/unlimited';
import { testEngine } from '@/lib/search';
import { loadVault, secret } from '@/lib/secrets';
import { sendMail } from '@/lib/mailer';
import { sendWhatsApp } from '@/lib/notify';
import { xLive } from '@/lib/live';
import { track } from '@/lib/obs';

export const maxDuration = 120;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  return Response.json({ catalog: CATALOG, ...(await unlimitedStatus()) });
}

// POST {action:'test', id} → proves the key really works (owner only — proxy enforces)
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  await loadVault();
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const opt = CATALOG.flatMap((c) => c.options).find((o) => o.id === id);
  if (!opt) return bad('unknown option');
  let res: { ok: boolean; detail: string };
  try {
    if (opt.engine) { const r = await testEngine(opt.engine); res = { ok: r.ok, detail: r.ok ? `${r.n} results in ${r.ms} ms — e.g. ${r.sample[0] || ''}` : r.error || 'no results' }; }
    else if (opt.id === 'gmail' || opt.id === 'brevo') { const via = await sendMail(secret('DIGEST_TO'), 'FDE Job Finder — email test', '<p style="font-family:system-ui">✅ Email to any address works.</p>'); res = { ok: true, detail: `sent via ${via} to ${secret('DIGEST_TO')}` }; }
    else if (opt.id === 'callmebot') { await sendWhatsApp('✅ FDE Job Finder — WhatsApp works'); res = { ok: true, detail: 'WhatsApp sent' }; }
    else if (opt.id === 'telegram') { const r = await fetch(`https://api.telegram.org/bot${secret('TELEGRAM_BOT_TOKEN')}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: secret('TELEGRAM_CHAT_ID'), text: '✅ FDE Job Finder — Telegram alerts work' }) }); res = { ok: r.ok, detail: r.ok ? 'Telegram message sent' : (await r.text()).slice(0, 200) }; }
    else if (opt.id === 'twitterapi') { const r = await xLive('"AI engineer"'); res = { ok: !r.needsKey && !r.error, detail: r.needsKey ? 'TWITTERAPI_IO_KEY not set' : r.error || `${r.posts.length} hiring tweets from the last 24 h` }; }
    else if (opt.id === 'github_token') { const r = await fetch('https://api.github.com/rate_limit', { headers: { Authorization: `Bearer ${secret('GITHUB_TOKEN')}`, 'User-Agent': 'fde-job-finder' } }); const d = await r.json(); res = { ok: r.ok && d.rate?.limit > 60, detail: `${d.rate?.remaining}/${d.rate?.limit} calls left this hour` }; }
    else if (opt.id === 'apify') { const r = await fetch('https://api.apify.com/v2/users/me', { headers: { Authorization: `Bearer ${secret('APIFY_TOKEN')}` } }); res = { ok: r.ok, detail: r.ok ? 'token valid' : `HTTP ${r.status}` }; }
    else if (opt.id === 'google') res = { ok: Boolean(secret('GOOGLE_CLIENT_ID') && secret('GOOGLE_CLIENT_SECRET')), detail: secret('GOOGLE_CLIENT_ID') ? 'configured — try “Continue with Google” on the login page in a private window' : 'not set' };
    else res = { ok: false, detail: 'Test this one in AI & Keys (Test button on the provider)' };
  } catch (e) { res = { ok: false, detail: (e as Error).message.slice(0, 200) }; }
  await track('system', `key test: ${opt.name}`, res.ok ? 'ok' : 'fail', res.detail);
  return Response.json(res);
}
