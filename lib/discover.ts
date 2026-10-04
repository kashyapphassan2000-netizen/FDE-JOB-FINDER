import type { CompanyEntry, RawJob } from './types';
import { classify, isExcluded, locationAllowed, locationTags } from './classify';
import { guessAts } from './atsdetect';
import { decodeEntities, getJson, getText, parseRss, pool, relativeToIso } from './http';
import { DEFAULT_COMPANIES } from './companies';
import { getSettings, saveSettings } from './settings';
import { getJSON, setJSON } from './store';
import { aiConfigured, chatJson } from './llm';
import { loadVault } from './secrets';
import { newsSearch, type NewsItem } from './news';

/**
 * Hidden jobs & new startups — low-crowd places most applicants never check:
 *  1. YC companies that are hiring (Bengaluru/India, remote, USA) — yc-oss public directory (free, daily)
 *  2. Freshly funded startups from funding news feeds (India: ET Tech funding, Inc42, YourStory; global: TechCrunch, Crunchbase News)
 *  3. For each, find their public careers board (Greenhouse/Lever/Ashby/Workable) or YC job list and count FDE / AI-ML roles
 * One click "Watch" → the company is polled on every refresh from then on.
 */
export interface DiscoveredCompany {
  key: string;
  name: string;
  website?: string;
  location: string;
  region: ('BLR' | 'INDIA' | 'USA' | 'REMOTE')[];
  source: string; // "YC W24" | "Funding: TechCrunch"
  sourceUrl?: string;
  tags: string[];
  teamSize?: number;
  stage?: string;
  fundingNews?: string;
  fundedAt?: string;
  ats?: { ats: CompanyEntry['ats']; slug: string; total: number };
  ycSlug?: string;
  roles: { title: string; location: string; url: string }[]; // open FDE / AI-ML roles found
  hiddenScore: number;
  checkedAt: string;
  status: 'new' | 'watched' | 'dismissed';
}

const FEEDS: { url: string; label: string; region: 'INDIA' | 'GLOBAL' }[] = [
  { url: 'https://economictimes.indiatimes.com/tech/funding/rssfeeds/78570540.cms', label: 'ET Tech funding', region: 'INDIA' },
  { url: 'https://inc42.com/feed/', label: 'Inc42', region: 'INDIA' },
  { url: 'https://yourstory.com/feed', label: 'YourStory', region: 'INDIA' },
  { url: 'https://techcrunch.com/tag/funding/feed/', label: 'TechCrunch funding', region: 'GLOBAL' },
  { url: 'https://news.crunchbase.com/feed/', label: 'Crunchbase News', region: 'GLOBAL' },
];
const AI_HINT = /\bai\b|artificial intelligence|machine learning|\bml\b|llm|genai|generative|agent|robot|autonom|chip|semiconductor|deeptech|deep tech|vision|data|automation|copilot|model/i;
const FUND_RX = /([A-Z][\w.&'’+-]*(?:\s+[A-Z0-9][\w.&'’+-]*){0,3})\s*(?:,[^,]{0,60},\s*)?(?:has\s+)?(?:raises|raised|secures|secured|bags|bagged|lands|closes|nets|picks up|gets|snags|scores)\b/i;
const STOP = new Set(['exclusive', 'report', 'startup', 'the', 'ai', 'india', 'indian', 'funding', 'why', 'how', 'this', 'week', 'here']);

/** Freshness rules: funding news older than this is ignored/purged; a company not re-checked in STALE_DAYS is hidden. */
export const FUND_FRESH_DAYS = 30;
export const STALE_DAYS = 14;

const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

function regionOf(loc: string): DiscoveredCompany['region'] {
  const t = locationTags({ title: '', company: '', url: '', location: loc });
  const r: DiscoveredCompany['region'] = [];
  if (t.includes('BLR')) r.push('BLR');
  if (t.includes('INDIA')) r.push('INDIA');
  if (t.includes('USA')) r.push('USA');
  if (/remote/i.test(loc)) r.push('REMOTE');
  return r;
}

function hiddenScore(c: Omit<DiscoveredCompany, 'hiddenScore'>): number {
  let s = 0;
  if (c.teamSize && c.teamSize < 50) s += 3;
  else if (c.teamSize && c.teamSize < 200) s += 2;
  if (c.fundedAt && Date.now() - Date.parse(c.fundedAt) < 60 * 864e5) s += 3;
  if (c.region.includes('BLR')) s += 3;
  else if (c.region.includes('INDIA')) s += 2;
  if (c.region.includes('REMOTE')) s += 1;
  if (c.tags.some((t) => AI_HINT.test(t))) s += 2;
  s += Math.min(5, c.roles.length * 2);
  return s;
}

async function ycCandidates(): Promise<Omit<DiscoveredCompany, 'hiddenScore' | 'roles' | 'checkedAt' | 'status'>[]> {
  const all = await getJson<any[]>('https://yc-oss.github.io/api/companies/hiring.json', { timeoutMs: 40000 });
  return all
    .filter((c) => c.status === 'Active' && c.isHiring)
    .map((c) => {
      const regions: string[] = c.regions || [];
      const loc = `${c.all_locations || ''} ${regions.includes('Remote') || regions.includes('Fully Remote') ? 'Remote' : ''}`.trim();
      return {
        key: keyOf(c.name), name: c.name, website: c.website, location: loc, region: regionOf(`${loc} ${regions.join(' ')}`),
        source: `YC ${String(c.batch || '').replace(/(Winter|Summer|Fall|Spring) (\d{4})/, (_: string, s: string, y: string) => `${s[0]}${y.slice(2)}`)}`,
        sourceUrl: c.url, tags: [...(c.tags || []), ...(c.industries || [])].slice(0, 8), teamSize: Number(c.team_size) || undefined, stage: c.stage, ycSlug: c.slug,
      };
    })
    .filter((c) => c.region.length && c.tags.some((t) => AI_HINT.test(t)));
}

async function fundingCandidates(): Promise<Omit<DiscoveredCompany, 'hiddenScore' | 'roles' | 'checkedAt' | 'status'>[]> {
  const out: Omit<DiscoveredCompany, 'hiddenScore' | 'roles' | 'checkedAt' | 'status'>[] = [];
  const res = await pool(FEEDS, 5, async (f) => ({ f, items: parseRss(await getText(f.url, { timeoutMs: 20000 })) }));
  const useAI = await aiConfigured();
  // + dated Google/Bing news for funding rounds in the last 7 days (India + global)
  const news = await newsSearch(['AI startup raises funding India', 'Bengaluru startup raises Series A', 'AI startup raises seed round', 'AI startup raises Series B', 'generative AI startup funding round'], 7, { perQuery: 15 }).catch(() => ({ items: [] as NewsItem[] }));
  if (news.items.length) res.push({ status: 'fulfilled', value: { f: { url: '', label: 'News (last 7 days)', region: 'GLOBAL' as const }, items: news.items.map((n) => ({ title: n.title, link: n.url, pubDate: n.date, description: `${n.source} · ${n.snippet}` })) } });
  const cutoff = Date.now() - FUND_FRESH_DAYS * 864e5;
  for (const r of res) {
    if (r.status !== 'fulfilled') continue;
    const { f } = r.value;
    const items = r.value.items.filter((x) => !x.pubDate || Date.parse(x.pubDate) > cutoff); // old funding news → skipped
    let picked: { name: string; item: (typeof items)[number] }[] = [];
    if (useAI) {
      try {
        const { data } = await chatJson<{ companies: { i: number; name: string }[] }>('Extract startup names that just RAISED funding. Only AI / ML / robotics / chips / deep-tech / SaaS-with-AI startups.',
          `Headlines:\n${items.slice(0, 40).map((x, i) => `${i}. ${x.title} — ${x.description.slice(0, 140)}`).join('\n')}\nJSON: {"companies":[{"i":0,"name":"CompanyName"}]}`, { maxTokens: 800, timeoutMs: 40000 });
        picked = (data?.companies || []).filter((c) => items[c.i] && c.name).map((c) => ({ name: c.name, item: items[c.i] }));
      } catch {}
    }
    if (!picked.length) {
      for (const it of items) {
        const m = decodeEntities(it.title).match(FUND_RX);
        if (!m || !AI_HINT.test(`${it.title} ${it.description}`)) continue;
        const name = m[1].split(/\s+/).filter((w) => !STOP.has(w.toLowerCase())).slice(-3).join(' ');
        if (name.length >= 2) picked.push({ name, item: it });
      }
    }
    for (const p of picked) {
      out.push({
        key: keyOf(p.name), name: p.name, location: f.region === 'INDIA' ? 'India' : '', region: f.region === 'INDIA' ? ['INDIA'] : [],
        source: `Funding: ${f.label}`, sourceUrl: p.item.link, tags: ['recently funded'], fundingNews: p.item.title, fundedAt: p.item.pubDate || undefined,
      });
    }
  }
  return out;
}

async function ycRoles(slug: string): Promise<{ title: string; location: string; url: string }[]> {
  const html = await getText(`https://www.ycombinator.com/companies/${slug}/jobs`, { timeoutMs: 15000 });
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) return [];
  const d = JSON.parse(decodeEntities(m[1]));
  return (d?.props?.jobPostings || [])
    .map((j: any) => ({ title: j.title, location: j.location || '', url: `https://www.ycombinator.com${j.url}`, postedAt: relativeToIso(j.createdAt ? `${j.createdAt} ago` : null) }))
    .filter((j: RawJob) => classify({ ...j, company: '' }).length);
}

export async function getDiscovered(all = false): Promise<DiscoveredCompany[]> {
  const list = await getJSON<DiscoveredCompany[]>('disc:companies', []);
  return all ? list : list.filter(isFresh);
}

/** Watched companies always stay; others must be re-checked recently, and "recently funded" must be recent. */
function isFresh(c: DiscoveredCompany): boolean {
  if (c.status === 'watched') return true;
  if (Date.now() - Date.parse(c.checkedAt) > STALE_DAYS * 864e5) return false;
  if (c.source.startsWith('Funding') && c.fundedAt && Date.now() - Date.parse(c.fundedAt) > 2 * FUND_FRESH_DAYS * 864e5) return false;
  return true;
}

export async function runDiscover(budgetMs = 240000): Promise<{ added: number; checked: number; total: number; log: string[] }> {
  const t0 = Date.now();
  const log: string[] = [];
  await loadVault();
  const settings = await getSettings();
  const watched = new Set([...DEFAULT_COMPANIES, ...settings.extraCompanies].map((c) => keyOf(c.name)));
  const existing = await getDiscovered(true);
  const byKey = new Map(existing.map((c) => [c.key, c]));

  const [yc, fund] = await Promise.allSettled([ycCandidates(), fundingCandidates()]);
  const cands = [...(fund.status === 'fulfilled' ? fund.value : []), ...(yc.status === 'fulfilled' ? yc.value : [])];
  log.push(`candidates: ${fund.status === 'fulfilled' ? fund.value.length : 'funding feeds failed'} from funding news, ${yc.status === 'fulfilled' ? yc.value.length : 'YC failed'} from YC`);

  // check companies not seen in the last 7 days; recently-funded first, then India/BLR, then small teams
  const due = cands
    .filter((c) => !watched.has(c.key))
    .filter((c) => { const p = byKey.get(c.key); return !p || Date.now() - Date.parse(p.checkedAt) > 3 * 864e5; })
    .sort((a, b) => (b.fundedAt ? 1 : 0) - (a.fundedAt ? 1 : 0) || (b.region.includes('BLR') ? 1 : 0) - (a.region.includes('BLR') ? 1 : 0) || (a.teamSize || 999) - (b.teamSize || 999));
  const batch = due.slice(0, 150);
  let added = 0;
  const res = await pool(batch, 6, async (c) => {
    if (Date.now() - t0 > budgetMs) return null;
    let roles: DiscoveredCompany['roles'] = [];
    let ats: DiscoveredCompany['ats'];
    const d = await guessAts(c.name).catch(() => null);
    if (d) {
      ats = { ats: d.ats, slug: d.slug, total: d.total };
      roles = d.jobs.filter((j) => classify(j).length && !isExcluded(j, settings)).slice(0, 10).map((j) => ({ title: j.title, location: j.location, url: j.url }));
    }
    if (!roles.length && c.ycSlug) roles = (await ycRoles(c.ycSlug).catch(() => [])).filter((r) => !isExcluded({ ...r, company: '' }, settings));
    const base = { ...c, ats, roles, checkedAt: new Date().toISOString(), status: (byKey.get(c.key)?.status || 'new') as DiscoveredCompany['status'] };
    return { ...base, hiddenScore: hiddenScore(base) } as DiscoveredCompany;
  });
  for (const r of res) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    if (!byKey.has(r.value.key)) added++;
    byKey.set(r.value.key, r.value);
  }
  log.push(`dropped stale: ${existing.filter((c) => !isFresh(c)).length} (not re-checked in ${STALE_DAYS} days or funding older than ${2 * FUND_FRESH_DAYS} days)`);
  log.push(`checked ${batch.length} companies for careers boards in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const all = [...byKey.values()].filter(isFresh).sort((a, b) => b.roles.length - a.roles.length || b.hiddenScore - a.hiddenScore).slice(0, 600);
  // auto-watch: new startups with a public board AND an FDE / AI role you can take (Bengaluru or remote-from-India) →
  // polled on every refresh from now on, so their new jobs reach Jobs / Companies hiring without you clicking anything
  const auto = await getJSON<string[]>('disc:auto', []);
  const known = new Set(settings.extraCompanies.map((c) => `${c.ats}:${c.slug}`));
  const fits = (r: DiscoveredCompany['roles'][number]) => locationAllowed(locationTags({ title: r.title, company: '', url: r.url, location: r.location }), r.location);
  const toWatch = all.filter((c) => c.status === 'new' && c.ats && c.roles.some(fits) && !known.has(`${c.ats.ats}:${c.ats.slug}`)).slice(0, 25);
  if (toWatch.length && auto.length < 300) {
    for (const c of toWatch) c.status = 'watched';
    await saveSettings({ extraCompanies: [...settings.extraCompanies, ...toWatch.map((c) => ({ ats: c.ats!.ats, slug: c.ats!.slug, name: c.name, tag: c.region.includes('INDIA') || c.region.includes('BLR') ? ('india' as const) : undefined }))] });
    await setJSON('disc:auto', [...auto, ...toWatch.map((c) => c.key)]);
    log.push(`auto-watched ${toWatch.length} new startups with FDE/AI roles you can take: ${toWatch.map((c) => c.name).join(', ')}`);
  }
  await setJSON('disc:companies', all);
  await setJSON('disc:meta', { at: new Date().toISOString(), log });
  return { added, checked: batch.length, total: all.length, log };
}

export async function setDiscoveredStatus(key: string, status: DiscoveredCompany['status']) {
  const all = await getDiscovered(true);
  const c = all.find((x) => x.key === key);
  if (!c) throw new Error('unknown company');
  c.status = status;
  await setJSON('disc:companies', all);
  return c;
}
