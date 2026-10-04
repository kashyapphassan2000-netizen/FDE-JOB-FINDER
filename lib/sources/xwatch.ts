import type { RawJob, SourceDef } from '../types';
import { pool } from '../http';
import { getJSON } from '../store';

/**
 * Free real-time X: reads the public embedded timeline of hiring-heavy accounts (no X API, no key).
 * Watch list = accounts from your Excel + every author the AI agent has seen posting a hiring tweet (auto-learned)
 * + anything you add in Settings. Only hiring tweets with an FDE / AI-ML role become jobs.
 */
export const DEFAULT_X_ACCOUNTS = ['aijobsai', 'aimljobs', 'ycombinator', 'workatastartup', 'latentspacepod', 'swyx', 'AnthropicAI', 'OpenAIDevs', 'sarvamai', 'GoogleDeepMind', 'huggingface', 'LangChainAI', 'llama_index'];

const HIRING = /\b(hiring|we('|’)re hiring|we are hiring|join (us|our team)|open roles?|looking for|dm me|send (your )?(cv|resume)|apply)\b/i;
const ROLE = /(forward[\s-]?deployed (?:ai |software )?engineers?|founding (?:ai |ml |full[- ]?stack )?engineers?|(?:senior |staff |lead )?(?:applied ai|ai|ml|llm|genai|gen ai|machine learning|research|deployment|solutions|mlops|agent|inference) engineers?|data scientists?|applied scientists?|research scientists?)/i;

export async function xWatchList(extra: string[] = []): Promise<string[]> {
  const learned = await getJSON<string[]>('x:authors', []);
  return Array.from(new Set([...extra, ...DEFAULT_X_ACCOUNTS, ...learned].map((h) => h.replace(/^@/, '').trim()).filter(Boolean)));
}

async function timeline(handle: string, signal: AbortSignal): Promise<{ id: string; text: string; created: string; handle: string; name: string }[]> {
  const r = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`, { signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36', Accept: 'text/html' } });
  if (!r.ok) throw new Error(`@${handle}: HTTP ${r.status}`);
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const d = JSON.parse(m[1]);
  const entries: any[] = d?.props?.pageProps?.timeline?.entries || [];
  return entries
    .map((e) => e?.content?.tweet)
    .filter(Boolean)
    .map((t: any) => ({ id: t.id_str, text: (t.full_text || t.text || '').replace(/&amp;/g, '&'), created: t.created_at, handle: t.user?.screen_name || handle, name: t.user?.name || handle }));
}

export const X_WATCH_SOURCE: SourceDef = {
  id: 'x_watch',
  retired: 'Retired: X’s public endpoint rate-limits unauthenticated calls (HTTP 429). For reliable X coverage add TWITTERAPI_IO_KEY (twitterapi.io source); X hiring posts are also found by the X / Twitter agent tab via search',
  name: 'X accounts watch (free, no API)',
  group: 'Community & social',
  keyless: true,
  envKeys: [],
  defaultIntervalMin: 360,
  covers: 'Latest tweets of hiring accounts from your Excel (@aijobsai, @aimljobs…) + founders the agent found hiring (auto-learned)',
  docs: 'Public embedded-timeline endpoint (syndication.twitter.com); add accounts in Settings → X accounts',
  run: async (ctx) => {
    const handles = (await xWatchList((ctx.settings as any).xAccounts || [])).slice(0, 60);
    const warnings: string[] = [];
    const res = await pool(handles, 4, (h) => timeline(h, ctx.signal));
    const out: RawJob[] = [];
    res.forEach((r, i) => {
      if (r.status !== 'fulfilled') return void warnings.push((r.reason as Error).message.slice(0, 60));
      for (const t of r.value) {
        if (!HIRING.test(t.text)) continue;
        const role = t.text.match(ROLE)?.[1];
        if (!role) continue;
        const loc = /bengaluru|bangalore|blr/i.test(t.text) ? 'Bengaluru' : /remote/i.test(t.text) ? (/\b(us|usa|united states|uk|europe|eu)\b[- ]?(only|based)/i.test(t.text) ? 'Remote (US/EU only)' : 'Remote') : '';
        out.push({ title: role.replace(/\b\w/g, (c) => c.toUpperCase()), company: `${t.name} (@${t.handle}) on X`, location: loc, url: `https://x.com/${t.handle}/status/${t.id}`, postedAt: t.created ? new Date(t.created).toISOString() : null, description: t.text.slice(0, 1200) });
      }
      void handles[i];
    });
    if (warnings.length === handles.length && handles.length) throw new Error(`X timelines unavailable: ${warnings[0]}`);
    return Object.assign(out, { warnings: warnings.slice(0, 5) });
  },
};
