import { ping, getJSON, hgetall, setJSON } from './store';
import { allProfiles, chat } from './llm';
import { embed, embedder } from './semantic';
import { availableEngines, readPage, searchStatus, searchUsage, webSearch } from './search';
import { mailerStatus } from './mailer';
import { notifyConfigured } from './notify';
import { secret } from './secrets';
import { blobConfigured } from './cv';
import { events } from './obs';
import { getLockdown, members } from './access';
import { getHealth, getMeta } from './refresh';
import { SOURCES } from './sources';

/** Full service check: every dependency the app uses, pass / warn / fail, what it means and exactly how to fix it. */
export interface Check { group: string; name: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string; ms?: number }
const timed = async <T>(fn: () => Promise<T>): Promise<[T | null, number, string]> => { const t = Date.now(); try { return [await fn(), Date.now() - t, '']; } catch (e) { return [null, Date.now() - t, (e as Error).message.slice(0, 200)]; } };
const ago = (iso?: string | null) => (iso ? `${Math.round((Date.now() - Date.parse(iso)) / 6e4)} min ago` : 'never');

export async function runHealthCheck(): Promise<{ at: string; checks: Check[] }> {
  const C: Check[] = [];
  // storage
  const p = await ping();
  C.push({ group: 'Core', name: 'Database (Upstash Redis)', status: p.ok ? 'ok' : 'fail', detail: p.ok ? `${p.mode}` : p.error || 'down', fix: p.ok ? undefined : 'Vercel → Storage → connect Upstash for Redis' });
  C.push({ group: 'Core', name: 'CV storage (Vercel Blob)', status: blobConfigured() ? 'ok' : 'warn', detail: blobConfigured() ? 'connected' : 'not connected — CV upload will fail', fix: blobConfigured() ? undefined : 'Vercel → Storage → create a Blob store (private) and connect it' });
  // AI providers — a tiny real call to each
  const profs = (await allProfiles()).filter((x) => x.enabled && x.key);
  for (const pr of profs) {
    const [r, ms, err] = await timed(() => chat('Reply with the single word OK.', 'Say OK', { profileId: pr.id, strict: true, maxTokens: 50, timeoutMs: 25000 }));
    C.push({ group: 'AI models', name: pr.label, status: r ? 'ok' : pr.key === 'keyless' || /429|quota|rate|resting/i.test(err) ? 'warn' : 'fail', detail: r ? `answered via ${r.model} in ${ms} ms` : err, ms, fix: r ? undefined : /429|quota|rate|resting/i.test(err) ? 'Free quota used up for now — it rotates to the next provider automatically; add another free key (Groq / Cerebras / OpenRouter) for headroom' : 'Check the key in AI & Keys (Test button) or disable this provider' });
  }
  if (!profs.length) C.push({ group: 'AI models', name: 'AI providers', status: 'fail', detail: 'none configured', fix: 'AI & Keys → add Gemini or Groq (free)' });
  const eng = await embedder();
  if (eng) { const [v, ms, err] = await timed(() => embed(['health check'])); C.push({ group: 'AI models', name: `Embeddings (${eng})`, status: v ? 'ok' : 'warn', detail: v ? `${v[0].length}-dim vector in ${ms} ms` : err, ms, fix: v ? undefined : 'Semantic ranking resumes when the per-minute quota frees up' }); }
  else C.push({ group: 'AI models', name: 'Embeddings', status: 'warn', detail: 'no embedding provider', fix: 'Add a free Gemini key in AI & Keys' });
  // search / reading
  const engs = availableEngines();
  // a never-cached query, so this tests the engine itself (not yesterday's cache)
  // test every live engine for real (a natural query — nonsense tokens make engines return nothing and caused false alarms)
  const { liveEngines, testEngine } = await import('./search');
  const live = await liveEngines();
  const per = await Promise.all(live.map(async (e) => ({ id: e.id, r: await testEngine(e.id).catch((x) => ({ ok: false, n: 0, ms: 0, sample: [], error: (x as Error).message })) })));
  const good = per.filter((p) => p.r.ok);
  const ws = good.length ? { results: new Array(good.reduce((n, p) => n + p.r.n, 0)), engine: good.map((p) => `${p.id} (${p.r.n} in ${p.r.ms} ms)`).join(', '), errors: per.filter((p) => !p.r.ok).map((p) => `${p.id}: ${p.r.error || 'no results'}`) } : { results: [], engine: '', errors: per.map((p) => `${p.id}: ${p.r.error || 'no results'}`) };
  const wms = Math.max(0, ...good.map((p) => p.r.ms));
  const werr = good.length ? '' : ws.errors.join(' · ');
  const ss = await searchStatus();
  const u = await searchUsage();
  C.push({ group: 'Search & reading', name: `Web search (${engs.map((e) => e.label.split(' (')[0]).join(', ') || 'none'})`, status: ws?.results.length ? (u.used / Math.max(1, u.limit) > 0.85 ? 'warn' : 'ok') : 'fail', detail: (ws?.results.length ? `${good.length}/${live.length} engines answering: ${ws.engine}${ws.errors.length ? ` · failing: ${ws.errors.join(' · ')}` : ''} · ${u.used}/${u.limit} free searches counted this month` : `${werr || ws?.errors.join(' · ') || 'no results'}`) + (ss.parked.length ? ` · QUOTA USED UP: ${ss.parked.map((p) => `${p.id} until ${new Date(p.until).toISOString().slice(0, 10)}`).join(', ')}` : ''), fix: ws?.results.length && u.used / Math.max(1, u.limit) <= 0.85 ? undefined : 'Add more free search keys (Serper 2,500, Brave 2,000/mo, Firecrawl, Exa) in AI & Keys' });
  const [pg, pms, perr] = await timed(() => readPage('https://example.com', 2000));
  C.push({ group: 'Search & reading', name: 'Page reader (Jina)', status: pg && pg.length > 50 ? 'ok' : 'fail', detail: pg ? `${pg.length} chars in ${pms} ms` : perr, fix: pg ? undefined : 'Add a free JINA_API_KEY for higher limits' });
  // messaging
  const m = mailerStatus();
  C.push({ group: 'Messaging', name: 'Email to YOU (owner)', status: m.gmail || m.brevo || m.resend ? 'ok' : 'fail', detail: m.gmail ? 'Gmail' : m.brevo ? 'Brevo' : m.resend ? 'Resend (test mode: only your own address)' : 'no sender', fix: m.gmail || m.brevo || m.resend ? undefined : 'AI & Keys → GMAIL_USER + GMAIL_APP_PASSWORD' });
  C.push({ group: 'Messaging', name: 'Email to OTHER people (sign-in codes, job alerts for others, reports to others)', status: m.canEmailAnyone ? 'ok' : 'fail', detail: m.canEmailAnyone ? (m.gmail ? 'Gmail (500/day)' : m.brevo ? 'Brevo (300/day)' : 'Resend with your domain') : 'NOT POSSIBLE right now — Resend test mode only reaches your own address. Users\' sign-in codes are relayed to you instead.', fix: m.canEmailAnyone ? undefined : 'Fastest (3 min): Google Account → Security → 2-Step Verification ON → App passwords → create → paste GMAIL_USER (your Gmail) + GMAIL_APP_PASSWORD (16 letters) in AI & Keys → Access. Or free Brevo: sign up → verify your Gmail as sender → BREVO_API_KEY + BREVO_SENDER.' });
  const n = notifyConfigured();
  C.push({ group: 'Messaging', name: 'WhatsApp to you', status: n.whatsapp ? 'ok' : 'warn', detail: n.whatsapp ? 'CallMeBot / Twilio set' : 'not connected', fix: n.whatsapp ? undefined : 'Settings → WhatsApp alerts (free CallMeBot, 3 minutes): save +34 694 25 79 94, send “I allow callmebot to send me messages”, paste WHATSAPP_PHONE + CALLMEBOT_APIKEY' });
  // sign-in
  const ms = await members();
  const lock = await getLockdown();
  C.push({ group: 'Access & sign-in', name: 'Google sign-in', status: secret('GOOGLE_CLIENT_ID') && secret('GOOGLE_CLIENT_SECRET') ? 'ok' : 'warn', detail: secret('GOOGLE_CLIENT_ID') ? 'on' : 'off — users cannot “Continue with Google”', fix: secret('GOOGLE_CLIENT_ID') ? undefined : 'console.cloud.google.com → APIs & Services → Credentials → Create OAuth client (Web) → redirect URI https://fde-job-finder.vercel.app/api/auth/google/callback → paste GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in AI & Keys → Access' });
  C.push({ group: 'Access & sign-in', name: 'Users', status: lock ? 'warn' : 'ok', detail: `${ms.filter((x) => x.role !== 'owner').length} users${lock ? ' · LOCKDOWN ON (only owners can enter)' : ''}`, fix: lock ? 'Settings → Access → turn lockdown off' : undefined });
  // pipelines (from what actually ran)
  const ev = await events({ limit: 1500 });
  const lastOf = (rx: RegExp) => ev.find((e) => e.area === 'cron' && rx.test(e.name));
  const meta = await getMeta();
  C.push({ group: 'Pipelines', name: 'Job refresh', status: meta && Date.now() - Date.parse(meta.lastRefresh || "") < 6 * 36e5 ? 'ok' : 'warn', detail: `last ${ago(meta?.lastRefresh)} · ${meta?.total ?? 0} jobs · failed: ${meta?.failed.join(', ') || 'none'}`, fix: meta && Date.now() - Date.parse(meta.lastRefresh || "") < 6 * 36e5 ? undefined : 'For every-30-min refresh: GitHub repo → Settings → Secrets → APP_URL + CRON_SECRET (Actions workflow), or run `npm run worker`' });
  const h = await getHealth();
  const broken = SOURCES.filter((s) => !s.retired && h[s.id] && !h[s.id].ok && !h[s.id].skipped?.startsWith('Add env'));
  C.push({ group: 'Pipelines', name: 'Job sources', status: broken.length ? 'warn' : 'ok', detail: broken.length ? `failing: ${broken.map((s) => `${s.id} (${(h[s.id].error || '').slice(0, 50)})`).join(', ')}` : `${Object.values(h).filter((x) => x.ok).length} healthy`, fix: broken.length ? 'See Sources & APIs for each error' : undefined });
  const sem = await getJSON<{ at: string; pending: number } | null>('sem:meta', null);
  C.push({ group: 'Pipelines', name: 'AI ranking (semantic)', status: sem ? (sem.pending > 50 ? 'warn' : 'ok') : 'warn', detail: sem ? `last ${ago(sem.at)} · ${sem.pending} jobs waiting` : 'never ran', fix: sem && sem.pending <= 50 ? undefined : 'Runs after each refresh; free embedding quota limits how many per minute' });
  for (const [label, rx] of [['Watched companies', /^watch/], ['Mentor daily brief', /^mentor/], ['Daily digest', /digest/], ['Alerts', /^alerts/]] as [string, RegExp][]) {
    const e = lastOf(rx);
    C.push({ group: 'Pipelines', name: label, status: !e ? 'warn' : e.status === 'ok' ? 'ok' : 'fail', detail: e ? `last ${ago(e.at)} · ${e.detail.slice(0, 140)}` : 'no run recorded yet (logging started with this version)' });
  }
  const subs = Object.values(await hgetall<{ email: string; lastResult?: string; active: boolean }>('subs'));
  C.push({ group: 'Pipelines', name: 'Job alerts for others', status: !subs.length ? 'ok' : subs.some((s) => /fail/i.test(s.lastResult || '')) ? 'fail' : 'ok', detail: subs.length ? subs.map((s) => `${s.email}: ${s.lastResult || 'not sent yet'}`).join(' · ').slice(0, 300) : 'no subscribers', fix: subs.some((s) => /fail/i.test(s.lastResult || '')) ? 'Needs email to other people — see Messaging above' : undefined });
  const ext: [string, string][] = [];
  for (const [name, url] of ext) {
    const [r, t, err] = await timed(() => fetch(url, { headers: { 'User-Agent': `FDE-Job-Finder health ${secret('SEC_CONTACT_EMAIL') || secret('DIGEST_TO') || 'admin@fde-job-finder.vercel.app'}`, ...(url.includes('github') && secret('GITHUB_TOKEN') ? { Authorization: `Bearer ${secret('GITHUB_TOKEN')}` } : {}) }, signal: AbortSignal.timeout(10000) }));
    let extra = '';
    if (r && url.includes('github')) { try { const d = await r.json(); extra = ` · ${d.rate?.remaining}/${d.rate?.limit} calls left this hour`; } catch {} }
    C.push({ group: 'External APIs', name, status: r?.ok ? 'ok' : 'warn', detail: r ? `HTTP ${r.status} in ${t} ms${extra}` : err, fix: url.includes('github') && !secret('GITHUB_TOKEN') ? 'Add a free GITHUB_TOKEN for 5,000 calls/h' : undefined });
  }
  const out = { at: new Date().toISOString(), checks: C };
  await setJSON('obs:health', out);
  return out;
}
