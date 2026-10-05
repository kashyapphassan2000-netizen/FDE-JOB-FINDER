/**
 * Plain-English search → what a job search engine needs.
 * "find me AI engineer jobs in Berlin posted today, remote ok" → { keywords: 'AI engineer', location: 'Berlin', remote: true, hours: 24 }
 * Deterministic (no AI call) so it is instant and never fails.
 */
export interface Nlq { raw: string; keywords: string; location: string; remote: boolean; hours: number; terms: string[] }

const FILLER = /\b(please|pls|plz|can you|could you|i want|i need|i'm looking for|im looking for|looking for|search( for)?|find( me)?|get( me)?|show( me)?|give( me)?|fetch|list|all|any|some|the|latest|new|newest|fresh|recent|recently|jobs?|roles?|openings?|positions?|vacanc(y|ies)|opportunit(y|ies)|posts?|tweets?|hiring|who (is|are) hiring|on (x|twitter|linkedin)|from (x|twitter|linkedin)|x posts|linkedin posts|posted|today|yesterday|this week|last week|past week|last \d+ (hours?|days?)|past \d+ (hours?|days?)|in the last \d+ (hours?|days?)|24 ?h(ours)?|for me|related to|about|with|that|which|are|is|me|my|of|and|or|a|an|to|now|in|at|for|on|from|by|ok|okay|fine|also|too)\b/gi;
const REMOTE = /\b(remote|work from home|wfh|anywhere|distributed)\b/i;
// "in Berlin", "at Bengaluru", "near Pune", "based in London, UK" — stops at the next clause word
const LOC = /\b(?:in|at|near|around|based in|located in|from)\s+([A-Z][\w.'-]*(?:[ ,]+(?!posted|today|remote|with|for|and|or|that|who|this|last|past)[A-Z][\w.'-]*){0,3})/;
const KNOWN_LOC = /\b(bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|india|usa|united states|uk|united kingdom|london|berlin|germany|europe|emea|apac|singapore|dubai|uae|canada|toronto|sf|san francisco|new york|nyc|seattle|austin|amsterdam|paris|dublin|sydney|tokyo|worldwide|global)\b/i;

export function parseQuery(raw: string): Nlq {
  const text = (raw || '').trim();
  const hours = /\btoday|24 ?h|last day|past day|last 24\b/i.test(text) ? 24 : /\bweek|7 days|last \d days\b/i.test(text) ? 168 : /\bmonth|30 days\b/i.test(text) ? 720 : 24;
  const remote = REMOTE.test(text);
  let location = (text.match(LOC)?.[1] || '').replace(/[,\s]+$/, '');
  if (location && /^(the|a|an|my|our|ai|ml|fde)$/i.test(location)) location = '';
  if (!location) location = text.match(KNOWN_LOC)?.[1] || '';
  let kw = text;
  if (location) kw = kw.replace(new RegExp(`\\b(?:in|at|near|around|based in|located in|from)?\\s*${location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' ');
  kw = kw.replace(REMOTE, ' ').replace(FILLER, ' ').replace(/[?!.;:",]+/g, ' ').replace(/\s+/g, ' ').trim();
  // keep quoted phrases exactly as typed
  const quoted = [...text.matchAll(/"([^"]{2,60})"/g)].map((m) => m[1]);
  const keywords = quoted.length ? quoted.join(' ') : kw;
  const terms = Array.from(new Set(keywords.toLowerCase().split(/[\s,/]+/).filter((w) => w.length > 1)));
  return { raw: text, keywords, location: location.replace(/\b\w/g, (c) => c.toUpperCase()), remote, hours, terms };
}

/** Does this text match what the user typed (all words for short queries, most for long ones)? */
export function matchesQuery(text: string, nlq: Nlq): boolean {
  if (!nlq.terms.length) return true;
  const t = text.toLowerCase();
  const hit = nlq.terms.filter((w) => t.includes(w) || (w === 'ai' && /\bai\b|artificial intelligence|llm|genai/.test(t)) || (w === 'ml' && /\bml\b|machine learning/.test(t))).length;
  return hit >= Math.max(1, Math.ceil(nlq.terms.length * (nlq.terms.length <= 2 ? 1 : 0.6)));
}
