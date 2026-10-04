/**
 * Exact publish time from the post URL itself — no guessing, no search-engine dates (those are often the crawl date,
 * which is why old posts looked "new").
 *  - X / Twitter status IDs are Snowflakes: ms = (id >> 22) + 1288834974657
 *  - LinkedIn activity / ugcPost / share IDs carry the ms timestamp in their first 41 bits: ms = id >> 22
 */
export function dateFromUrl(url: string): string | null {
  try {
    const x = url.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d{15,20})/i);
    if (x) return iso(Number(BigInt(x[1]) >> 22n) + 1288834974657);
    const li = url.match(/linkedin\.com\/.*?(?:activity|ugcPost|share)[:-](\d{18,20})/i);
    if (li) return iso(Number(BigInt(li[1]) >> 22n));
  } catch {}
  return null;
}

function iso(ms: number): string | null {
  // sanity: between 2010 and tomorrow
  return ms > 1262304000000 && ms < Date.now() + 864e5 ? new Date(ms).toISOString() : null;
}

/** Is this a social post whose date we can only trust from the URL? */
export const isSocialPost = (url: string) => /\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/|linkedin\.com\/(posts|feed\/update)/i.test(url);

/**
 * Posting date written in the text itself: "3 days ago", "2 hours ago", "Posted 5d ago", "yesterday", "just now",
 * "Posted on Oct 2, 2026", "2026-10-02". `ref` = when the text was captured. Returns null when the text has no date.
 */
export function dateFromText(text: string, ref: string | number = Date.now()): string | null {
  if (!text) return null;
  const t = typeof ref === 'number' ? ref : Date.parse(ref) || Date.now();
  const s = text.slice(0, 600);
  const rel = s.match(/\b(\d{1,3})\s*\+?\s*(minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mos?|years?|yrs?)\s+ago\b/i)
    || s.match(/\bposted\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|w|months?|mo)\b/i);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2].toLowerCase();
    const ms = /^(minutes?|mins?)$/.test(u) ? 6e4 : /^(hours?|hrs?|h)$/.test(u) ? 36e5 : /^(days?|d)$/.test(u) ? 864e5 : /^(weeks?|wks?|w)$/.test(u) ? 7 * 864e5 : /^(months?|mos?|mo)$/.test(u) ? 30 * 864e5 : 365 * 864e5;
    return new Date(t - n * ms).toISOString();
  }
  if (/\b(just now|moments? ago|an? (minute|hour) ago)\b/i.test(s)) return new Date(t).toISOString();
  if (/\b(a|one) day ago|yesterday\b/i.test(s)) return new Date(t - 864e5).toISOString();
  if (/\b(a|one) week ago\b/i.test(s)) return new Date(t - 7 * 864e5).toISOString();
  if (/\b(a|one) month ago\b/i.test(s)) return new Date(t - 30 * 864e5).toISOString();
  const abs = s.match(/\b(?:posted|published|date posted)[:\s]+(?:on\s+)?([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]{2,8} \d{4}|\d{4}-\d{2}-\d{2})/i) || s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (abs) {
    const d = Date.parse(abs[1]);
    if (d && d <= t + 864e5 && d > t - 3 * 365 * 864e5) return new Date(d).toISOString();
  }
  return null;
}

/** STRICT freshness window for jobs & posts everywhere in the app. */
export const FRESH_HOURS = Number(process.env.FRESH_HOURS) || 24;
