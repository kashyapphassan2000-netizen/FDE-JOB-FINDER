import type { Job } from './types';
import { extractSkills, freshnessHours } from './classify';
import { getCv } from './cv';
import { aiConfigured, chatJson } from './llm';
import { getJobs } from './refresh';
import { loadVault, secret } from './secrets';
import { getSettings } from './settings';
import { getJSON, hgetall, setJSON } from './store';

/**
 * Daily email digest: the N best FRESH jobs (posted < 24 h) ranked by
 *   CV match (40%) + pay (30%) + low competition (30%), never repeating a job already emailed.
 * Email goes out through Resend (free: 100/day). Without a verified domain Resend only delivers
 * to the address you signed up with, which is exactly the owner-only use case here.
 */

export interface DigestPick {
  job: Job;
  total: number;
  pay: number;
  payLabel: string;
  lowComp: number;
  compWhy: string[];
  cv: number;
  cvWhy: string;
  hours: number;
  postedKnown: boolean;
}

const INR_PER_USD = 85;

/** Parses "₹30L–45L", "INR 2,500,000 - 3,500,000 YEAR", "$180k–$220k", "$80/hr" … into annual USD (midpoint). */
export function parseSalaryUsd(s?: string): number | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/,/g, '');
  const inr = /₹|inr|rs\.?|lpa|lakh|\bl\b|crore|\bcr\b/.test(t);
  const nums: number[] = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(k|m|l|lpa|lakhs?|cr|crore)?/g)) {
    let n = parseFloat(m[1]);
    const u = m[2] || '';
    if (u === 'k') n *= 1e3;
    else if (u === 'm') n *= 1e6;
    else if (/^(l|lpa|lakh|lakhs)$/.test(u)) n *= 1e5;
    else if (/^(cr|crore)$/.test(u)) n *= 1e7;
    if (n > 0) nums.push(n);
  }
  if (!nums.length) return null;
  const top = nums.slice(0, 2);
  let v = top.reduce((a, b) => a + b, 0) / top.length;
  if (/hour|hr\b|\/h\b/.test(t)) v *= 2000;
  else if (/month|\/mo\b|pm\b/.test(t)) v *= 12;
  if (inr) v /= INR_PER_USD;
  if (v < 3000 || v > 3e6) return null; // junk parse
  return Math.round(v);
}

function payScore(j: Job): { score: number; label: string } {
  const usd = parseSalaryUsd(j.salary);
  const india = j.locTags.includes('INDIA') || j.locTags.includes('BLR');
  if (usd) {
    // India pay benchmarked against ₹50 L (~$59k) = 100; elsewhere against $250k = 100
    const score = Math.min(100, Math.round((usd / (india ? 59000 : 250000)) * 100));
    return { score, label: j.salary!.slice(0, 60) };
  }
  // No salary published → estimate from role/company type (clearly labelled as an estimate)
  let s = 35;
  if (j.domain === 'AI_LAB') s += 35;
  else if (j.domain === 'AI_INFRA') s += 25;
  else if (j.domain === 'FINTECH' || j.domain === 'SEMI') s += 15;
  if (j.categories.includes('FDE')) s += 15;
  if (j.seniority === 'senior') s += 15;
  if (j.locTags.includes('USA') || (j.locTags.includes('REMOTE') && !india)) s += 10;
  s = Math.min(90, s);
  return { score: s, label: s >= 70 ? 'not listed · likely high (est.)' : s >= 50 ? 'not listed · likely good (est.)' : 'not listed' };
}

const MAINSTREAM = ['linkedin', 'jsearch', 'serpapi', 'apify_linkedin', 'adzuna', 'jooble'];

function lowCompScore(j: Job, hours: number): { score: number; why: string[] } {
  const why: string[] = [];
  let s = 0;
  if (j.hidden) { s += 50; why.push('not on LinkedIn/aggregators, not a big brand'); }
  else if (!j.sources.some((x) => MAINSTREAM.includes(x))) { s += 30; why.push('only on the company careers page'); }
  else s += 10;
  if (hours < 6) { s += 35; why.push('posted < 6 h ago (early applicant)'); }
  else if (hours < 12) { s += 25; why.push('posted < 12 h ago'); }
  else if (hours < 24) s += 15;
  if (j.sources.length === 1) s += 15;
  return { score: Math.min(100, s), why };
}

export async function digestCandidates(maxAgeH: number, exclude: Set<string>): Promise<DigestPick[]> {
  const [jobs, cv, tracked] = await Promise.all([getJobs(), getCv(), hgetall<unknown>('track')]);
  const cvSet = new Set(cv.skills);
  const out: DigestPick[] = [];
  for (const j of jobs) {
    if (exclude.has(j.id) || tracked[j.id] || !j.categories.length) continue;
    const hours = freshnessHours(j.postedAt, j.firstSeen);
    if (hours > maxAgeH) continue;
    const pay = payScore(j);
    const comp = lowCompScore(j, hours);
    const hit = extractSkills(`${j.title} ${j.description || ''}`).filter((s) => cvSet.has(s));
    const cvWhy = !cv.skills.length ? 'upload your CV for matching' : hit.length ? `matches: ${hit.slice(0, 6).join(', ')}` : 'few skills listed in the post';
    const total = Math.round(0.4 * j.cvMatch + 0.3 * pay.score + 0.3 * comp.score + (j.categories.includes('FDE') ? 10 : 0) + (j.postedAt ? 0 : -10));
    out.push({ job: j, total, pay: pay.score, payLabel: pay.label, lowComp: comp.score, compWhy: comp.why, cv: j.cvMatch, cvWhy, hours, postedKnown: Boolean(j.postedAt) });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** If an AI provider is set, re-rank the top candidates against the actual CV text (one call, cheap). */
async function aiRerank(picks: DigestPick[]): Promise<{ picks: DigestPick[]; ai?: string }> {
  const cv = await getCv();
  if (!cv.text || !(await aiConfigured())) return { picks };
  const pool = picks.slice(0, 30);
  const list = pool.map((p, i) => `${i}. ${p.job.title} | ${p.job.company} | ${p.job.location} | ${p.job.salary || 'salary n/a'} | ${(p.job.description || '').slice(0, 250).replace(/\s+/g, ' ')}`).join('\n');
  try {
    const { data, meta } = await chatJson<{ i: number; fit: number; why: string }[]>(
      'You are a blunt tech recruiter. Score how well the candidate CV fits each job (0-100) for actually getting an interview. One short reason each (max 14 words), mention the concrete matching or missing skill.',
      `CV:\n${cv.text.slice(0, 3500)}\n\nJOBS:\n${list}\n\nReturn a JSON array: [{"i":0,"fit":72,"why":"..."}] for every job.`,
      { maxTokens: 2500, timeoutMs: 60000 },
    );
    if (!Array.isArray(data)) return { picks };
    for (const r of data) {
      const p = pool[Number(r.i)];
      if (!p || typeof r.fit !== 'number') continue;
      p.cv = Math.max(0, Math.min(100, Math.round(r.fit)));
      p.cvWhy = String(r.why || p.cvWhy).slice(0, 140);
      p.total = Math.round(0.4 * p.cv + 0.3 * p.pay + 0.3 * p.lowComp + (p.job.categories.includes('FDE') ? 10 : 0) + (p.postedKnown ? 0 : -10));
    }
    return { picks: [...pool.sort((a, b) => b.total - a.total), ...picks.slice(30)], ai: `${meta.provider} · ${meta.model}` };
  } catch (e) {
    console.error('digest ai rerank', e);
    return { picks };
  }
}

const esc = (s: string) => (s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const agoTxt = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : `${Math.round(h)} h ago`);

function renderHtml(picks: DigestPick[], appUrl: string, note: string): string {
  const rows = picks.map((p, i) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e5e7eb">
      <div style="font-size:16px;font-weight:600"><a href="${esc(p.job.url)}" style="color:#1d4ed8;text-decoration:none">${i + 1}. ${esc(p.job.title)}</a></div>
      <div style="color:#374151;margin:2px 0">${esc(p.job.company)} · ${esc(p.job.location || 'n/a')} · ${p.postedKnown ? 'posted' : 'first seen'} ${agoTxt(p.hours)}</div>
      <div style="font-size:13px;color:#4b5563">
        <b>CV fit ${p.cv}%</b> – ${esc(p.cvWhy)}<br/>
        <b>Pay</b> – ${esc(p.payLabel)}<br/>
        <b>Competition</b> – ${p.lowComp >= 60 ? 'low' : p.lowComp >= 35 ? 'medium' : 'high'}${p.compWhy.length ? ` (${esc(p.compWhy.join('; '))})` : ''}
      </div>
      <div style="margin-top:6px"><a href="${esc(p.job.url)}" style="background:#1d4ed8;color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px">Apply</a></div>
    </td></tr>`).join('');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:auto;color:#111827">
    <h2 style="margin-bottom:4px">${picks.length} fresh FDE / AI jobs for you</h2>
    <div style="color:#6b7280;font-size:13px">Posted in the last 24 h · ranked by CV fit, pay and low competition · ${esc(note)}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">${rows}</table>
    ${appUrl ? `<p style="font-size:13px"><a href="${esc(appUrl)}">Open your job portal</a> for every other job.</p>` : ''}
  </div>`;
}

export function emailConfigured() {
  return { resend: Boolean(secret('RESEND_API_KEY')), to: secret('DIGEST_TO') };
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const from = secret('DIGEST_FROM') || 'FDE Job Finder <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: to.split(/[,;\s]+/).filter(Boolean), subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export interface DigestResult { sent: boolean; count: number; to?: string; skipped?: string; ai?: string; picks: { id: string; title: string; company: string; total: number; cv: number; pay: string; url: string }[] }

export async function runDigest(opts: { force?: boolean; dryRun?: boolean } = {}): Promise<DigestResult> {
  await loadVault();
  const settings = await getSettings();
  const meta = await getJSON<{ at: string } | null>('digest:meta', null);
  if (!opts.force && !opts.dryRun && meta && Date.now() - Date.parse(meta.at) < 20 * 36e5) return { sent: false, count: 0, skipped: 'already sent in the last 20 h', picks: [] };
  const sentIds = await getJSON<string[]>('digest:sent', []);
  const n = settings.digestCount;
  let picks = await digestCandidates(settings.digestMaxAgeHours, new Set(sentIds));
  // Thin day? widen to 48 h rather than sending a near-empty mail
  if (picks.length < n) picks = await digestCandidates(Math.max(48, settings.digestMaxAgeHours), new Set(sentIds));
  const re = await aiRerank(picks);
  const top = re.picks.slice(0, n);
  const summary = top.map((p) => ({ id: p.job.id, title: p.job.title, company: p.job.company, total: p.total, cv: p.cv, pay: p.payLabel, url: p.job.url }));
  if (opts.dryRun) return { sent: false, count: top.length, ai: re.ai, picks: summary };
  const { resend, to } = emailConfigured();
  if (!resend || !to) return { sent: false, count: top.length, skipped: 'Set RESEND_API_KEY and DIGEST_TO (AI & Keys tab or Vercel env)', ai: re.ai, picks: summary };
  if (!top.length) return { sent: false, count: 0, skipped: 'no new matching jobs in the last 48 h', picks: [] };
  const appUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const day = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  await sendEmail(to, `${top.length} fresh FDE/AI jobs – ${day}`, renderHtml(top, appUrl, re.ai ? `AI-matched to your CV (${re.ai})` : 'skill-matched to your CV'));
  await Promise.all([
    setJSON('digest:sent', [...top.map((p) => p.job.id), ...sentIds].slice(0, 3000)),
    setJSON('digest:meta', { at: new Date().toISOString(), count: top.length }),
  ]);
  return { sent: true, count: top.length, to, ai: re.ai, picks: summary };
}
