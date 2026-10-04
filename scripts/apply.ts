/**
 * Auto-apply runner — runs on YOUR computer, in a real browser window you can watch.
 *
 *   npm i -D playwright && npx playwright install chromium     (once)
 *   APPLY_TOKEN=fdejf_... npm run apply                          fill every queued application, you review + submit
 *   APPLY_TOKEN=fdejf_... npm run apply -- --submit --max 5      fill AND submit (stops for captchas / missing answers)
 *
 * Queue applications in the app (Auto-apply page → Prepare → ✓ Queue). The token: Agent studio → Connect Claude Code.
 * Safety: max 10 per run, only jobs YOU queued, never LinkedIn, stops when a captcha or an unanswered required field appears.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { FILLER_SRC } from '../lib/applyfill';

const APP = process.env.APP_URL || 'https://fde-job-finder.vercel.app';
const TOKEN = process.env.APPLY_TOKEN || '';
const SUBMIT = process.argv.includes('--submit');
const MAX = Math.min(10, Number(process.argv[process.argv.indexOf('--max') + 1]) || 5);
const H = { Authorization: `Bearer ${TOKEN}` };

async function main() {
  if (!TOKEN) throw new Error('Set APPLY_TOKEN (Agent studio → Connect Claude Code → New token)');
  // optional dependency — installed only on machines that run the runner
  const mod = 'playwright';
  let chromium: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { ({ chromium } = await import(mod)); } catch { throw new Error('Install once: npm i -D playwright && npx playwright install chromium'); }
  const q = await (await fetch(`${APP}/api/apply/runner?queue=1`, { headers: H })).json();
  if (q.error) throw new Error(q.error);
  const kits = (q.kits || []).slice(0, MAX);
  if (!kits.length) { console.log('Nothing queued. In the app: Auto-apply → Prepare a job → ✓ Queue.'); return; }
  // your CV file, attached to every application
  const cvRes = await fetch(`${APP}/api/apply/runner?cv=1`, { headers: H });
  let cvPath = '';
  if (cvRes.ok) { const name = (cvRes.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'CV.pdf'; cvPath = join(mkdtempSync(join(tmpdir(), 'fde-')), name); writeFileSync(cvPath, Buffer.from(await cvRes.arrayBuffer())); }
  else console.warn('⚠ No CV in the app — attach it yourself in each form.');
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const report = async (id: string, status: string, note: string) => { await fetch(`${APP}/api/apply/runner`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status, note }) }).catch(() => null); };
  for (const k of kits) {
    console.log(`\n▶ ${k.title} — ${k.company}\n  ${k.applyUrl}`);
    const page = await ctx.newPage();
    try {
      await page.goto(k.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      // some boards show the form only after "Apply"
      const applyBtn = page.locator('a:has-text("Apply for this job"), button:has-text("Apply for this job"), a:has-text("Apply now"), button:has-text("Apply now"), button:has-text("Apply")').first();
      if (await applyBtn.isVisible().catch(() => false)) { await applyBtn.click().catch(() => null); await page.waitForTimeout(2500); }
      const out = await page.evaluate(`(${FILLER_SRC})(${JSON.stringify({ profile: q.profile, kit: k })})`) as { filled: number; need: string[] };
      if (cvPath) { const file = page.locator('input[type=file]').first(); if (await file.count()) await file.setInputFiles(cvPath).catch(() => null); }
      const missing = k.fields.filter((f: { required: boolean; needsYou: boolean }) => f.required && f.needsYou).map((f: { label: string }) => f.label);
      console.log(`  filled ${out.filled} fields${out.need.length ? ` · could not match: ${out.need.join(', ')}` : ''}${missing.length ? ` · REQUIRED, needs you: ${missing.join(' | ')}` : ''}`);
      const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]').count();
      if (SUBMIT && !missing.length && !captcha) {
        const submit = page.locator('button[type=submit]:has-text("Submit"), button:has-text("Submit application"), button:has-text("Submit Application"), input[type=submit]').first();
        if (await submit.isVisible().catch(() => false)) {
          await submit.click();
          await page.waitForTimeout(6000);
          const ok = await page.locator('text=/thank you|application (has been )?(submitted|received)|we.?ve received/i').count();
          console.log(ok ? '  ✅ submitted' : '  ⚠ clicked submit — confirmation not detected, check the window');
          await report(k.id, ok ? 'applied' : 'failed', ok ? 'submitted by runner' : 'submit clicked, no confirmation seen');
          continue;
        }
      }
      if (captcha) console.log('  🧩 captcha on this form — solve it in the window');
      await rl.question('  Review the window, submit it yourself if it looks right, then press Enter here (type "s" + Enter to mark skipped) ').then(async (a) => report(k.id, a.trim().toLowerCase() === 's' ? 'queued' : 'applied', a.trim().toLowerCase() === 's' ? 'skipped in runner' : 'submitted by you after autofill'));
    } catch (e) {
      console.log(`  ✗ ${(e as Error).message.slice(0, 160)}`);
      await report(k.id, 'failed', (e as Error).message.slice(0, 200));
    }
  }
  rl.close();
  await browser.close();
}
main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
