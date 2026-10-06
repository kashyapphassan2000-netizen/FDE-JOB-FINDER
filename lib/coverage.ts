import platforms from '@/data/platforms.json';
import type { SourceHealth } from './types';
import { SOURCES, sourceConfigured } from './sources';
import { DEFAULT_COMPANIES } from './companies';
import { CAREER_PAGES } from './sources/careerpages';
import { DEFAULT_X_ACCOUNTS } from './sources/xwatch';
import { BOARDS } from './sources/boardreader';

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
  [/mercor\.com$/, ['mercor']], [/jpmc\.fa\.oraclecloud\.com$|jpmorgan/, ['jpmc']], [/razorpay\.com$/, ['greenhouse:razorpaysoftwareprivatelimited']], [/browserstack\.com$/, ['workday:browserstack|wd3|External']], [/(^|\.)salesforce\.com$/, ['workday:salesforce|wd12|External_Career_Site']], [/adobe\.com$/, ['workday:adobe|wd5|external_experienced']], [/(^|\.)nvidia\.com$/, ['workday:nvidia|wd5|NVIDIAExternalCareerSite']], [/target\.com$/, ['workday:target|wd5|targetcareers']], [/equinix\.com$/, ['workday:equinix|wd1|External']], [/gecareers\.com$|gevernova/, ['workday:gevernova|wd5|Vernova_ExternalSite']], [/research\.samsung\.com$|samsung\.com$/, ['workday:sec|wd3|Samsung_Careers']], [/entrackr\.com$|growthlist\.co$|crunchbase\.com$/, ['discover']], [/postman\.com$/, ['workday:postman|wd108|careers']], [/atlassian\.com$|bloomberg\.avature\.net$|bloomberg\.com$/, ['bigco']], [/(^|\.)devpost\.com$/, ['opps']], [/(^|\.)t\.me$/, ['telegram']],
  [/(^|\.)reddit\.com$/, ['reddit']], [/news\.ycombinator\.com|hn\.hiring-search\.com/, ['hn']],
  [/yourstory\.com$|inc42\.com$|economictimes|techcrunch\.com$|news\.crunchbase\.com$/, ['discover']], [/ycombinator\.com$|workatastartup\.com$/, ['yc_jobs', 'discover']],
];
// Excel boards read by the page reader (boardreader source) — status per board host
for (const [, host] of BOARDS) EXTRA.push([new RegExp(`(^|\\.)${host.replace(/\./g, '\\.')}$`), [`cp:br:${host}`]]);
const FEEDLESS_KINDS = new Set(['tool', 'certification', 'oss_program', 'devrel', 'resource', 'referral', 'newsletter', 'staffing']);
const KEYED = new Set(SOURCES.filter((s) => !s.keyless).map((s) => s.id));

export type CpStatus = Record<string, { at: string; ok: boolean; roles?: number; mine?: number; error?: string }>;
export function coverage(health: Record<string, SourceHealth>, extraCompanies: { ats: string; slug: string }[], discOk: boolean, subs: string[] = [], channels: string[] = [], cp: CpStatus = {}) {
  const subSet = new Set(subs.map((x) => x.toLowerCase()));
  const chSet = new Set(channels.map((x) => x.toLowerCase()));
  const watched = new Set([...DEFAULT_COMPANIES, ...extraCompanies].map((c) => `${c.ats}:${c.slug}`.toLowerCase()));
  const careerNames = CAREER_PAGES.map(([n, u]) => [n.toLowerCase().split(/[ (]/)[0], new URL(u).hostname.replace(/^www\./, '')] as const);
  const fresh = (h?: SourceHealth) => Boolean(h?.ok && h.lastSuccess && Date.now() - Date.parse(h.lastSuccess) < 3 * 864e5);
  const status = (c: string): 'ok' | 'failing' | 'needs_key' | 'off' => {
    if (c === 'discover') return discOk ? 'ok' : 'off';
    if (c === 'opps') return 'ok';
    if (c.startsWith('cp:')) {
      const st = cp[c.slice(3)];
      if (!st) return 'off';
      if (st.ok && !st.roles) return 'off'; // page read but 0 roles seen: no openings, or jobs load in a widget the reader can't see — NOT proven
      return st.ok && Date.now() - Date.parse(st.at) < 7 * 864e5 ? 'ok' : 'failing';
    }
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
    const cpHit = careerNames.find(([n, h]) => p.host.endsWith(h) || (n.length > 3 && p.name.toLowerCase().startsWith(n)));
    const cpName = cpHit ? CAREER_PAGES.find(([n]) => n.toLowerCase().split(/[ (]/)[0] === cpHit[0])?.[0] : undefined;
    if (cpName) conns.push(`cp:${cpName}`);
    // LinkedIn / Google-Jobs aggregators only count for their own site — they do not prove coverage of Wellfound, Google careers, etc.
    for (const c of ['linkedin', 'jsearch', 'serpapi', 'apify_linkedin']) if (!/linkedin\.com$/.test(p.host) && conns.includes(c) && !['jsearch', 'serpapi'].includes(c)) conns.splice(conns.indexOf(c), 1);
    // reddit / telegram are only live for the subreddits / channels the app actually watches
    const sub = p.url.match(/reddit\.com\/r\/([^/?#]+)/i)?.[1]?.toLowerCase();
    const ch = p.url.match(/t\.me\/(?:s\/)?([^/?#]+)/i)?.[1]?.toLowerCase();
    const scoped = conns.filter((c) => !(c === 'reddit' && sub && !subSet.has(sub)) && !(c === 'telegram' && ch && !chSet.has(ch)));
    const st = scoped.map((c) => ({ c, s: status(c) }));
    const ok = st.filter((x) => x.s === 'ok').map((x) => x.c);
    const failing = st.filter((x) => x.s === 'failing').map((x) => x.c);
    const needKey = st.filter((x) => x.s === 'needs_key').map((x) => SOURCES.find((s) => s.id === x.c)?.envKeys.join(' + ') || x.c);
    let eff: Eff;
    let detail: string;
    const gone = ([[/whylabs\.ai$/, 'WhyLabs shut down (2025) — nothing to fetch.'], [/dstack\.ai$/, 'dstack has no careers page / open roles — nothing to fetch.'], [/replicate\.com$/, 'Replicate shows no job listings any more — nothing to fetch.'], [/^groq\.com$/, 'groq.com/careers now redirects to the home page — no public job list to fetch.']] as [RegExp, string][]).find(([rx]) => rx.test(p.host || ''));
    if (gone) { eff = 'excluded'; detail = gone[1]; }
    else if (/^(x|twitter|linkedin)\.com$|\.linkedin\.com$/.test(p.host || '')) { eff = 'action'; detail = 'X / LinkedIn: removed from the app by you — check it yourself (the link opens it).'; }
    else if (p.mapping === 'excluded') { eff = 'excluded'; detail = 'Defunct or not worth your time (per your Excel).'; }
    else if (p.kind === 'relocation') { eff = 'out_of_rule'; detail = 'Relocation board — outside your rule (Bengaluru office or remote only). Open it only if you change the rule.'; }
    else if (p.kind === 'funding' && ok.includes('discover')) { eff = 'live_ok'; detail = 'Its funding feed is read automatically by the new-startup scanner (daily): freshly funded companies are checked for careers boards and auto-watched when they post roles you can take.'; }
    else if (FEEDLESS_KINDS.has(p.kind) || p.mapping === 'resource' || (p.kind === 'funding' && /linkedin\.com$/.test(p.host)) || /premium|sales navigator|course|certificat|^note|cross-reference|^companies hiring/i.test(p.name) || p.sheets.every((x) => /Scam_Red_Flags|Caveats|ATS_Guide|Skills_That_Pay|Dashboard/.test(x))) { eff = 'action'; detail = p.kind === 'staffing' ? 'Agency: register your CV once; they contact you. No public job feed.' : 'Not a job feed — a step to do (join, sign up, learn, use the tool).'; }
    else if (['job_board', 'talent_marketplace', 'gig_rlhf', 'freelance', 'social', 'company', 'community', 'competition', 'funding'].includes(p.kind)) {
      eff = p.kind === 'company' ? 'agent' : 'capture';
      if (ok.length) { const br = ok.find((c) => c.startsWith('cp:br:')); eff = 'live_ok'; detail = br ? `Page reader + AI read this board's search results with your words (last read ${cp[br.slice(3)]?.at.slice(0, 10)}, ${cp[br.slice(3)]?.roles ?? 0} jobs seen) — in rotation every few hours.` : ok.some((c) => c.startsWith('cp:')) ? `AI reads its careers page automatically (last read ${cp[ok.find((c) => c.startsWith('cp:'))!.slice(3)]?.at.slice(0, 10)}, ${cp[ok.find((c) => c.startsWith('cp:'))!.slice(3)]?.roles ?? 0} roles seen). Pages that only render after login can come back empty — capture to be sure.` : `Fetched automatically via ${ok.join(', ')}.`; return { id: p.id, eff, detail, connectors: conns }; }
      if (failing.length) { eff = 'live_failing'; detail = `Connected (${failing.join(', ')}) but the last run failed — see Sources & APIs.`; return { id: p.id, eff, detail, connectors: conns }; }
      detail = p.kind === 'company'
        ? `No public job-board API${cpName && cp[cpName] ? ` (its careers page was read ${cp[cpName].at.slice(0, 10)} but showed ${cp[cpName].roles ?? 0} roles — jobs probably load in a widget, so this is NOT proven coverage)` : ''}: reached only by AI-agent searches (partial). For full coverage open its careers page and click 📥 Capture.`
        : 'Blocks servers or needs your login: open the link while logged in and click 📥 Capture — every job on the page is imported.';
      if (needKey.length) detail += ` Automatic option: add ${needKey.join(' / ')} (paid/limited).`;
    } else if (ok.length) { eff = 'live_ok'; detail = `Fetched automatically via ${ok.join(', ')}.`; }
    else { eff = 'action'; detail = 'Reference / checklist item.'; }
    return { id: p.id, eff, detail, connectors: conns };
  });
}

export const X_ACCOUNTS_COUNT = DEFAULT_X_ACCOUNTS.length;
export const KEYED_SOURCES_IDS = KEYED;
