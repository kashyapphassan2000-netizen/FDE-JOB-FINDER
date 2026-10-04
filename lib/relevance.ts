import { locationAllowed, locationTags } from './classify';

/**
 * YOUR relevance profile — one definition of "relevant" used everywhere (Careers search, Jobs sort, alerts).
 * Pure module (no server imports) so the browser can score jobs too.
 *  roles     : in priority order — a job matching role #1 ranks above role #2, etc.
 *  locations : in priority order — Bengaluru first, then Remote (India OK), … ("Anywhere" accepts all)
 *  exclude   : words that kill a job (title or company)
 *  exp       : years of experience you want (jobs clearly outside are dropped)
 */
export interface Profile { roles: string[]; locations: string[]; exclude: string[]; expMin: number; expMax: number; mustAny: string[] }

export const ROLE_LIB: Record<string, string> = {
  'Forward Deployed Engineer': 'forward[\\s-]*deploy|\\bfde\\b|deployed (ai |software )?engineer',
  'AI Deployment / Deployment Strategist': 'deployment (engineer|strategist|lead|architect)|ai deployment|agent deployment',
  'Applied AI Engineer': 'applied (ai|ml)|applied scientist',
  'AI Solutions Engineer / Architect': '(solutions?|customer|field|implementation|sales) (engineer|architect)[^,]{0,30}\\b(ai|ml|llm|genai|gen ai|agents?)\\b|\\b(ai|ml|llm|genai|agentic)\\b[^,]{0,30}(solutions?|customer|field) (engineer|architect)',
  'Founding AI Engineer': 'founding[^,]{0,20}(ai|ml|llm|engineer)',
  'AI Engineer': '\\bai engineer|\\ba\\.i\\. engineer|artificial intelligence engineer|\\bai (software|developer)',
  'LLM / GenAI / Agents Engineer': '\\bllms?\\b|genai|gen ai|generative|agentic|\\bagents?\\b (engineer|developer)|\\brag\\b',
  'ML Engineer': 'machine learning engineer|\\bml engineer|\\bmle\\b|ml (software|platform|infra)',
  'MLOps / ML Platform': 'mlops|ml ?ops|ml platform|ai platform|model (serving|deployment)|inference',
  'Data Scientist': 'data scien',
  'Research Engineer / Scientist': 'research (engineer|scientist)|member of technical staff|\\bmts\\b',
  'Computer Vision / Perception': 'computer vision|perception|\\bcv\\b engineer',
  'Edge / Embedded AI': 'edge ai|on-device|embedded (ai|ml)|tinyml',
  'AI Product Manager': '(ai|ml|genai) product manager|product manager[^,]{0,20}\\b(ai|ml)\\b',
};
export const LOCATION_LIB = ['Bengaluru', 'Remote (India OK)', 'Hyderabad', 'Pune', 'Chennai', 'Mumbai', 'Delhi NCR', 'Remote (anywhere)', 'Anywhere'];

export const DEFAULT_PROFILE: Profile = {
  roles: ['Forward Deployed Engineer', 'AI Deployment / Deployment Strategist', 'Applied AI Engineer', 'AI Solutions Engineer / Architect', 'Founding AI Engineer', 'AI Engineer', 'LLM / GenAI / Agents Engineer', 'ML Engineer'],
  locations: ['Bengaluru', 'Remote (India OK)'],
  exclude: ['intern', 'internship', 'sales development', 'account executive', 'recruiter', 'marketing', 'paralegal'],
  expMin: 0, expMax: 30, mustAny: [],
};

const ALIAS: Record<string, string[]> = {
  bengaluru: ['bengaluru', 'bangalore', 'blr'], hyderabad: ['hyderabad', 'hyd', 'secunderabad'], pune: ['pune'], chennai: ['chennai'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane'], 'delhi ncr': ['delhi', 'gurgaon', 'gurugram', 'noida', 'ncr'],
};

/** Index of the first matching location in your priority list (-1 = not wanted). */
export function locationRank(loc: string, title: string, wanted: string[]): number {
  const L = `${loc} ${title}`.toLowerCase();
  const tags = locationTags({ title, company: '', url: '', location: loc });
  for (let i = 0; i < wanted.length; i++) {
    const w = wanted[i].toLowerCase();
    if (w === 'anywhere') return i;
    if (w.startsWith('remote (anywhere)')) { if (/remote|anywhere|worldwide|distributed/.test(L)) return i; continue; }
    if (w.startsWith('remote (india')) { if (tags.includes('REMOTE_IN') || (/remote/.test(L) && /india|apac|asia/.test(L))) return i; continue; }
    const names = ALIAS[w] || [w.replace(/\(.*\)/, '').trim()];
    if (names.some((n) => n && L.includes(n))) return i;
  }
  if (!loc.trim() || /^\s*\d+\s+locations?\s*$/i.test(loc)) return wanted.length; // not stated → keep, ranked last
  if (!wanted.length) return locationAllowed(tags, loc) ? 0 : -1;
  return -1;
}

export function roleRank(title: string, roles: string[]): number {
  for (let i = 0; i < roles.length; i++) {
    const src = ROLE_LIB[roles[i]] || roles[i].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]*');
    if (new RegExp(src, 'i').test(title)) return i;
  }
  return -1;
}

const yearsIn = (title: string, text: string): [number, number] | null => {
  const m = `${title} ${text}`.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years|yrs)/i) || `${title} ${text}`.match(/(\d{1,2})\s*\+\s*(?:years|yrs)/i);
  if (!m) return null;
  return [Number(m[1]), m[2] ? Number(m[2]) : Number(m[1]) + 5];
};

export interface Scored { score: number; roleRank: number; locRank: number; why: string[]; keep: boolean }
/** 0-100: role priority (60) + location priority (25) + freshness (15). keep=false → not what you want. */
export function scoreJob(j: { title: string; company?: string; location?: string; description?: string; postedAt?: string | null }, p: Profile): Scored {
  const why: string[] = [];
  const t = `${j.title} ${j.company || ''}`.toLowerCase();
  if (p.exclude.some((x) => x && new RegExp(`\\b${x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))) return { score: 0, roleRank: -1, locRank: -1, why: ['excluded word'], keep: false };
  const rr = roleRank(j.title, p.roles);
  const lr = locationRank(j.location || '', j.title, p.locations);
  if (rr < 0 || lr < 0) return { score: 0, roleRank: rr, locRank: lr, why: [rr < 0 ? 'role not in your list' : 'location not in your list'], keep: false };
  if (p.mustAny.length && !p.mustAny.some((w) => `${j.title} ${j.description || ''}`.toLowerCase().includes(w.toLowerCase()))) return { score: 0, roleRank: rr, locRank: lr, why: ['missing must-have word'], keep: false };
  const y = yearsIn(j.title, j.description || '');
  if (y && (y[0] > p.expMax || y[1] < p.expMin)) return { score: 0, roleRank: rr, locRank: lr, why: [`needs ${y[0]}+ yrs`], keep: false };
  const roleScore = 60 * (1 - rr / Math.max(p.roles.length, 1));
  const locScore = 25 * (1 - lr / Math.max(p.locations.length + 1, 1));
  const age = j.postedAt ? (Date.now() - Date.parse(j.postedAt)) / 864e5 : 30;
  const fresh = age <= 1 ? 15 : age <= 3 ? 12 : age <= 7 ? 9 : age <= 14 ? 6 : age <= 30 ? 3 : 0;
  why.push(`#${rr + 1} role: ${p.roles[rr]}`, lr < p.locations.length ? `#${lr + 1} location: ${p.locations[lr]}` : 'location not stated');
  if (j.postedAt) why.push(age < 1 ? 'posted today' : `posted ${Math.round(age)}d ago`);
  return { score: Math.round(roleScore + locScore + fresh), roleRank: rr, locRank: lr, why, keep: true };
}
