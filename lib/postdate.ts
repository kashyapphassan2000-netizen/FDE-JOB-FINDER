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
export const isSocialPost = (url: string) => /(?:x|twitter)\.com\/[^/]+\/status|linkedin\.com\/(posts|feed\/update)/i.test(url);
