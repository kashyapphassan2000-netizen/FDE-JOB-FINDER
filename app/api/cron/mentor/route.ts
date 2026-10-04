import { isCron, unauthorized } from '@/lib/auth';
import { activeSpaces, dailyBrief, getWorld } from '@/lib/mentor';
import { loadVault, secret } from '@/lib/secrets';
import { sendMail, esc } from '@/lib/mailer';
import { runAs } from '@/lib/tenant';
import { roleOf } from '@/lib/access';

export const maxDuration = 300;

// Vercel Cron (daily, early morning IST): refresh the world picture, write everyone's brief, email the owner's.
export async function GET(req: Request) {
  if (!isCron(req)) return unauthorized();
  await loadVault();
  const t0 = Date.now();
  await getWorld(true).catch(() => null);
  const spaces = await activeSpaces();
  if (!spaces.includes('owner')) spaces.unshift('owner');
  const log: string[] = [];
  for (const ns of spaces) {
    if (Date.now() - t0 > 240000) { log.push('time budget used'); break; }
    if (ns !== 'owner' && !(await roleOf(ns))) continue; // removed / expired users get nothing
    try {
      const b = await runAs(ns === 'owner' ? { ns: 'owner', email: 'owner', role: 'owner' } : { ns, email: ns, role: 'member' }, () => dailyBrief(ns, true));
      log.push(`${ns}: ${b.headline}`);
      const to = ns === 'owner' ? secret('DIGEST_TO') : ns;
      if (to) {
        const li = (xs: string[]) => xs.map((x) => `<li>${esc(x)}</li>`).join('');
        const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:640px;margin:auto"><div style="background:#0d1424;color:#fff;padding:16px 20px;border-radius:14px"><div style="opacity:.7;font-size:12px">YOUR DAILY BRIEF · ${b.date}</div><div style="font-size:18px;font-weight:700">${esc(b.headline)}</div></div><h3>What happened</h3><ul>${li(b.happened)}</ul><h3>What may happen</h3><ul>${li(b.mayHappen)}</ul><h3>Learn today</h3><ul>${b.learnToday.map((l) => `<li><b>${esc(l.topic)}</b> — ${esc(l.why)}<br><span style="color:#555">${esc(l.how)}</span></li>`).join('')}</ul><p><b>💰 Money:</b> ${esc(b.moneyMove)}</p><p><b>🚀 Career:</b> ${esc(b.careerMove)}</p><p><b>🧭 Life:</b> ${esc(b.lifeNote)}</p><p style="color:#999;font-size:12px">From your Life mentor · FDE Job Finder</p></div>`;
        await sendMail(to, `🧭 ${b.headline}`, html).catch((e) => log.push(`email ${ns}: ${(e as Error).message.slice(0, 80)}`));
      }
    } catch (e) { log.push(`${ns}: failed ${(e as Error).message.slice(0, 100)}`); }
  }
  return Response.json({ ok: true, log });
}
