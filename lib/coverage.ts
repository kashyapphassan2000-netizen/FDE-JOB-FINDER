import platforms from '@/data/platforms.json';
import type { SourceHealth } from './types';
import { SOURCES, sourceConfigured } from './sources';
import { DEFAULT_COMPANIES } from './companies';
import { CAREER_PAGES } from './sources/careerpages';
import { DEFAULT_X_ACCOUNTS } from './sources/xwatch';

/**
 * HONEST coverage of every platform/company in the Excel, decided at runtime from what is really connected
 * and really succeeding — not from what was planned. Statuses:
 *   live_ok       fetched automatically and the last run succeeded (≤ 3 days)
 *   live_failing  connected but the last attempt failed
 *   capture       login-only / blocks servers → open it and click 📥 Capture (works on ANY page you can see)
 *   agent         only reached through AI-agent web searches → partial
 *   action        not a job feed (tool, course, community, program) → a to-do for you
 *   out_of_rule   relocation abroad → outside your Bengaluru-or-remote rule
 *   excluded      defunct / scam
 */
export type Eff = 'live_ok' | 'live_failing' | 'capture' | 'agent' | 'action' | 'out_of_rule' | 'excluded';
type P = { id: string; name: string; url: string; host: string; mapping: string; connectors: string[]; searchTemplate: string; kind: string; sheets: string[]; notes: string };

// connectors added after the first map was built (host → connector ids)
const EXTRA: [RegExp, string[]][] = [
  [/(^|\.)internshala\.com$/, ['internshala']], [/(^|\.)nodesk\.co$/, ['nodesk']], [/80000hours\.org$/, ['eightyk']], [/(^|\.)unstop\.com$/, ['unstop', 'opps']],
  [/mercor\.com$/, ['mercor']], [/^(x|twitter)\.com$/, ['x_watch', 'agent:x-posts']], [/(^|\.)devpost\.com$/, ['opps']], [/(^|\.)t\.me$/, ['telegram']],
  [/(^|\.)reddit\.com$/, ['reddit']], [/news\.ycombinator\.com|hn\.hiring-search\.com/, ['hn']],
  [/yourstory\.com$|inc42\.com$|economictimes|techcrunch\.com$|news\.crunchbase\.com$/, ['discover']], [/ycombinator\.com$|workatastartup\.com$/, ['yc_jobs', 'discover']],
];
const FEEDLESS_KINDS = new Set(['tool', 'certification', 'oss_program', 'devrel', 'resource', 'referral', 'newsletter', 'staffing']);
const KEYED = new Set(SOURCES.filter((s) => !s.keyless).map((s) => s.id));

export function coverage(health: Record<string, SourceHealth>, extraCompanies: { ats: string; slug: string }[], discOk: boolean) {
  const watched = new Set([...DEFAULT_COMPANIES, ...extraCompanies].map((c) => `${c.ats}:${c.slug}`.toLowerCase()));
  const careerNames = CAREER_PAGES.map(([n, u]) => [n.toLowerCase().split(/[ (]/)[0], new URL(u).hostname.replace(/^www\./, '')] as const);
  const fresh = (h?: SourceHealth) => Boolean(h?.ok && h.lastSuccess && Date.now() - Date.parse(h.lastSuccess) < 3 * 864e5);
  const status = (c: string): 'ok' | 'failing' | 'needs_key' | 'off' => {
    if (c === 'discover') return discOk ? 'ok' : 'off';
    if (c === 'opps') return 'ok';
    if (c.startsWith('agent:')) return 'off';
    const [src, slug] = c.split(':');
    if (slug) return watched.has(`${src}:${slug}`.toLowerCase()) && fresh(health[src]) ? 'ok' : watched.has(`${src}:${slug}`.toLowerCase()) ? 'failing' : 'off';
    const def = SOURCES.find((s) => s.id === src);
    if (!def) return 'off';
    if (!sourceConfigured(def)) return 'needs_key';
    return fresh(health[src]) ? 'ok' : health[src]?.lastRun ? 'failing' : 'off';
  };

  return (platforms as P[]).map((p) => {
    const conns = Array.from(new Set([...p.connectors, ...EXTRA.filter(([rx]) => rx.test(p.host)).flatMap(([, c]) => c)]));
    const cp = careerNames.find(([n, h]) => p.host.endsWith(h) || (n.length > 3 && p.name.toLowerCase().startsWith(n)));
    if (cp) conns.push('careerpages');
    const st = conns.map((c) => ({ c, s: status(c) }));
    const ok = st.filter((x) => x.s === 'ok').map((x) => x.c);
    const failing = st.filter((x) => x.s === 'failing').map((x) => x.c);
    const needKey = st.filter((x) => x.s === 'needs_key').map((x) => SOURCES.find((s) => s.id === x.c)?.envKeys.join(' + ') || x.c);
    let eff: Eff;
    let detail: string;
    if (p.mapping === 'excluded') { eff = 'excluded'; detail = 'Defunct or not worth your time (per your Excel).'; }
    else if (p.kind === 'relocation') { eff = 'out_of_rule'; detail = 'Relocation board — outside your rule (Bengaluru office or remote only). Open it only if you change the rule.'; }
    else if (ok.length) { eff = 'live_ok'; detail = `Fetched automatically via ${ok.join(', ')}.`; }
    else if (failing.length) { eff = 'live_failing'; detail = `Connected (${failing.join(', ')}) but the last run failed — see Sources & APIs.`; }
    else if (FEEDLESS_KINDS.has(p.kind) || p.mapping === 'resource') { eff = 'action'; detail = p.kind === 'staffing' ? 'Agency: register your CV once; they contact you. No public job feed.' : 'Not a job feed — a step to do (join, sign up, learn, use the tool).'; }
    else if (['job_board', 'talent_marketplace', 'gig_rlhf', 'freelance', 'social', 'company', 'community', 'competition', 'funding'].includes(p.kind)) {
      eff = p.kind === 'company' ? 'agent' : 'capture';
      detail = p.kind === 'company'
        ? 'No public job board API: reached by AI-agent searches + LinkedIn search (partial). For full coverage open its careers page and click 📥 Capture, or add it in Settings → Companies.'
        : 'Blocks servers or needs your login: open the link while logged in and click 📥 Capture — every job on the page is imported.';
      if (needKey.length) detail += ` Automatic option: add ${needKey.join(' / ')} (paid/limited).`;
    } else { eff = 'action'; detail = 'Reference / checklist item.'; }
    return { id: p.id, eff, detail, connectors: conns };
  });
}

export const X_ACCOUNTS_COUNT = DEFAULT_X_ACCOUNTS.length;
export const KEYED_SOURCES_IDS = KEYED;
